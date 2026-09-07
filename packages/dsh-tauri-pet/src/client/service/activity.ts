import type { ClientContext } from 'dsh-tauri/client'
import type { SessionLiveActivity } from '../types'
import { createLifecycleController } from 'dsh-tauri/client'
import { PET_ACTIVITY_THROTTLE_MS } from '../constants'
import { foldSessionActivity } from '../utils/activity'
import { toTransferable } from '../utils/transferable'
import { pushPetSession } from './pet'

type SessionAction = 'create' | 'update' | 'remove'

/**
 * rc.2+ 会话 binding 附带的事件窗口（MutableSessionEventSource，service.js 组装
 * binding 时挂在 eventSource 字段）；alpha 运行时缺失，必须探测使用。
 */
interface RawSessionEventSource {
  getSnapshot: () => { entries: readonly unknown[] }
  subscribe: (listener: () => void) => () => void
}

interface RawSessionBinding {
  sessionId: string
  eventSource?: RawSessionEventSource
  session: {
    getSnapshot: () => unknown
    subscribe: (listener: () => void) => () => void
    open?: () => Promise<unknown>
  }
}

interface RawSessions {
  list: {
    getSnapshot: () => {
      byId?: Record<string, Record<string, unknown>>
      ids: readonly string[]
    }
    subscribe: (listener: () => void) => () => void
  }
  binding: (id: string) => RawSessionBinding | undefined
}

/** 每个已绑定会话的观察状态：订阅清理 + 折叠出的实时活动 + 节流定时器。 */
interface SessionWatch {
  disposers: Array<() => void>
  /** 事件窗口折叠结果；undefined 表示该会话无事件窗口（alpha），null 表示当前无活动 */
  activity?: SessionLiveActivity | null
  activityTimer?: ReturnType<typeof setTimeout>
}

/**
 * 将 DSH 会话原始快照按生命周期推送给桌宠窗口，不生成宠物专用 projection。
 * rc.2+ 会话额外订阅事件窗口（binding.eventSource）：流式 delta 逐 token 触发，
 * 按会话做 trailing 节流，到期时按当前窗口重算实时活动（进行中的工具调用 /
 * 思考流）并以 liveActivity 字段并入快照；alpha 缺失事件窗口时退级为纯快照转发。
 */
export function installPetSessionForwarder(ctx: ClientContext): void {
  ctx.effect(() => {
    const controller = createLifecycleController()
    const watches = new Map<string, SessionWatch>()
    const known = new Set<string>()
    let disposed = false

    function emit(action: SessionAction, session: Record<string, unknown>): void {
      if (disposed)
        return
      const payload = toTransferable(session) as Record<string, unknown>
      void pushPetSession(action, payload).catch((error) => {
        if (!disposed)
          console.error(`[dsh-tauri-pet] session ${action} push failed:`, error)
      })
    }

    const sessions = ctx.sessions as unknown as RawSessions

    function snapshotOf(id: string, binding: RawSessionBinding): Record<string, unknown> {
      const list = sessions.list.getSnapshot()
      const summary = list.byId?.[id]
      const snapshot = binding.session.getSnapshot()
      const value = snapshot && typeof snapshot === 'object'
        ? snapshot as Record<string, unknown>
        : { value: snapshot }
      const merged: Record<string, unknown> = { id: binding.sessionId, ...(summary ?? {}), ...value }
      // 仅在探测到事件窗口的会话上附带 liveActivity；null 也是有效值（清除过期活动展示）
      const watch = watches.get(id)
      if (watch?.activity !== undefined)
        merged.liveActivity = watch.activity
      return merged
    }

    /** 订阅事件窗口：这里只做 trailing 节流，到期时按当前窗口整体重算一次，一次突发只推送一帧。 */
    function attachEventSource(id: string, binding: RawSessionBinding, watch: SessionWatch): void {
      const source = binding.eventSource
      if (source === undefined || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function')
        return
      // 绑定即折叠一次，create 帧就携带已运行会话的实时活动
      const initial = source.getSnapshot()
      watch.activity = foldSessionActivity(initial.entries)
      watch.disposers.push(source.subscribe(() => {
        if (disposed || watches.get(id) !== watch || watch.activityTimer !== undefined)
          return
        watch.activityTimer = globalThis.setTimeout(() => {
          watch.activityTimer = undefined
          const current = source.getSnapshot()
          watch.activity = foldSessionActivity(current.entries)
          emit('update', snapshotOf(id, binding))
        }, PET_ACTIVITY_THROTTLE_MS)
      }))
      // dsh 只在会话被选中（open）时才建立事件流；子代理等未选中会话的
      // 窗口保持空窗，折叠恒为 null。主动打开会话流（幂等，UI 已开的会话
      // 直接返回），让任何选中状态下的事件都能进入窗口并触发上面的订阅。
      if (typeof binding.session.open === 'function') {
        void binding.session.open().catch((error: unknown) => {
          if (!disposed)
            console.warn(`[dsh-tauri-pet] open event stream for ${id} failed:`, error)
        })
      }
      watch.disposers.push(() => {
        if (watch.activityTimer !== undefined) {
          globalThis.clearTimeout(watch.activityTimer)
          watch.activityTimer = undefined
        }
      })
    }

    function bind(id: string, action: SessionAction): void {
      const binding = sessions.binding(id)
      if (binding === undefined) {
        emit(action, { id })
        return
      }
      const watch: SessionWatch = { disposers: [] }
      watches.set(id, watch)
      attachEventSource(id, binding, watch)
      emit(action, snapshotOf(id, binding))
      watch.disposers.push(binding.session.subscribe(() => emit('update', snapshotOf(id, binding))))
    }

    function unbind(id: string): void {
      const watch = watches.get(id)
      if (watch === undefined)
        return
      for (const dispose of watch.disposers)
        dispose()
      watches.delete(id)
    }

    function sync(): void {
      const list = sessions.list.getSnapshot()
      const ids = new Set(list.ids)
      for (const id of known) {
        if (!ids.has(id)) {
          unbind(id)
          emit('remove', { id })
        }
      }
      for (const id of ids) {
        const binding = sessions.binding(id)
        if (binding === undefined) {
          if (!known.has(id))
            bind(id, 'create')
          continue
        }
        if (watches.has(id)) {
          const watch = watches.get(id)
          // activity 保持 undefined 说明事件窗口此前不可用；运行中补挂一次（成功 attach 后值为 null，不会重复订阅）
          if (watch !== undefined && watch.activity === undefined && binding.eventSource !== undefined)
            attachEventSource(id, binding, watch)
          emit('update', snapshotOf(id, binding))
        }
        else {
          bind(id, known.has(id) ? 'update' : 'create')
        }
      }
      known.clear()
      for (const id of ids)
        known.add(id)
    }

    controller.add(sessions.list.subscribe(sync))
    const retryTimer = globalThis.setInterval(sync, 250)
    controller.add(() => globalThis.clearInterval(retryTimer))
    controller.add(() => {
      disposed = true
      for (const id of [...watches.keys()])
        unbind(id)
      known.clear()
    })
    sync()
    return () => controller.dispose()
  }, 'dsh-tauri-pet: raw session events')
}
