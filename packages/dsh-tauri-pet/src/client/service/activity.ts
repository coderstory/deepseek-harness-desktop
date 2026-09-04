import type { ClientContext } from 'dsh-tauri/client'
import type { PetObservable, PetRuntimeContext, PetSessionActivity, PetSessionSnapshot } from '../types'
import { compat, createLifecycleController } from 'dsh-tauri/client'
import { PET_ACTIVITY_EFFECT } from '../constants'
import { text } from '../locales'
import { activityBubble, mapPetActivity } from '../utils/activity'
import { setPetActivity } from './pet'

function activityLabel(activity: PetSessionActivity): string {
  switch (activity) {
    case 'failed':
      return text('activityFailed')
    case 'review':
      return text('activityReview')
    case 'running':
      return text('activityRunning')
    case 'waiting':
      return text('activityWaiting')
    case 'idle':
    default:
      return text('activityIdle')
  }
}

function resolvePendingSource(ctx: ClientContext): PetObservable<ReadonlyMap<string, unknown>> | undefined {
  const lookup = ctx as unknown as { get?: (name: string) => unknown }
  try {
    const service = lookup.get?.('uiSession') as PetRuntimeContext['uiSession'] | undefined
    return service?.pendingInteractions
  }
  catch {
    return undefined
  }
}

/** Mirror the current Codex session into the native pet status bridge. */
export function installPetActivity(ctx: ClientContext): void {
  ctx.effect(() => {
    const runtime = compat(ctx) as unknown as PetRuntimeContext
    const controller = createLifecycleController()
    const pendingSource = resolvePendingSource(ctx)
    let currentSessionId: string | undefined
    let currentSnapshot: PetSessionSnapshot | undefined
    let disposeSession: (() => void) | undefined
    let lastPayload = ''

    function push(): void {
      const list = runtime.sessions.list.getSnapshot()
      const id = list.current
      const summary = id === undefined ? undefined : list.byId?.[id]
      const pending = id === undefined
        ? undefined
        : pendingSource?.getSnapshot().get(id) ?? summary?.pendingInteraction
      const activity = mapPetActivity(summary, currentSnapshot, pending)
      const bubble = activityBubble(
        activity,
        activityLabel(activity),
        summary?.title ?? summary?.displayTitle,
      )
      const payload = `${activity}\u0000${bubble ?? ''}`
      if (payload === lastPayload)
        return
      lastPayload = payload
      void setPetActivity(activity, bubble).catch((error) => {
        console.error('[dsh-tauri-pet] update pet activity failed:', error)
      })
    }

    function syncCurrent(): void {
      const id = runtime.sessions.list.getSnapshot().current
      if (id !== currentSessionId) {
        disposeSession?.()
        disposeSession = undefined
        currentSessionId = id
        const source = id === undefined ? undefined : runtime.sessions.binding?.(id)?.session
        currentSnapshot = source?.getSnapshot()
        if (source !== undefined) {
          disposeSession = source.subscribe(() => {
            currentSnapshot = source.getSnapshot()
            push()
          })
        }
      }
      push()
    }

    controller.add(runtime.sessions.list.subscribe(syncCurrent))
    if (pendingSource !== undefined)
      controller.add(pendingSource.subscribe(push))
    controller.add(() => disposeSession?.())
    syncCurrent()
    return () => controller.dispose()
  }, PET_ACTIVITY_EFFECT)
}
