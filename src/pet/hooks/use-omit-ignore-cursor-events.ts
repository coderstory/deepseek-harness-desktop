import type { RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

interface DeviceMousePosition {
  x: number
  y: number
}

/**
 * 根据元素的真实屏幕位置自动切换桌宠窗口的点击穿透。
 *
 * 穿透后 WebView 不再收到 mouseenter/mouseleave，因此通过 Rust 端 CGEventTap
 * （macOS）/ rdev（Windows、Linux）全局鼠标流获取设备像素坐标，再与元素的
 * DOMRect 命中区比较。调用方只需传入可交互元素的 ref，不需要管理启动监听、
 * 窗口移动、缩放或穿透状态。
 *
 * 初始化策略：先调一次 `query_pet_cursor_position` 拿到当前光标位置，按是否
 * 落在 hitbox 设置初始 ignore 状态——而非盲开穿透后再等 device-mouse-move。
 * CGEventTap 不为静止光标发 MouseMoved，若用户光标已停在 hitbox 内才打开
 * 桌宠窗口，无显式查询会导致 setIgnoreCursorEvents(true) 永不翻转、首击被吞。
 *
 * Wayland / 查询不可用兜底：当 `query_pet_cursor_position` 返回 null（Linux
 * Wayland compositor 出于安全禁止 client 查询其他 surface 光标位置）或抛错，
 * 降级为 `setIgnoreCursorEvents(false)`（clickable），保证基础交互可用——比起
 * "永远卡在穿透层无法拖动"，多拦截几个空白处点击是更小的代价。
 */
export function useOmitIgnoreCursorEvents(elementRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const appWindow = getCurrentWindow()
    let disposed = false
    let isIgnored = true
    let windowPosition: { x: number, y: number } | undefined
    let geometryRevision = 0
    let unlistenMouseMove: (() => void) | undefined
    let unlistenMoved: (() => void) | undefined
    let unlistenResized: (() => void) | undefined

    function setIgnoreCursorEvents(ignore: boolean): void {
      if (ignore === isIgnored)
        return
      isIgnored = ignore
      void appWindow.setIgnoreCursorEvents(ignore).catch(() => {})
    }

    async function refreshWindowPosition(): Promise<void> {
      const revision = ++geometryRevision
      const position = await appWindow.innerPosition()
      if (!disposed && revision === geometryRevision)
        windowPosition = position
    }

    function isCursorInElement(x: number, y: number): boolean | undefined {
      const element = elementRef.current
      if (element === null || windowPosition === undefined)
        return undefined

      const rect = element.getBoundingClientRect()
      const scale = globalThis.devicePixelRatio || 1
      const left = windowPosition.x + rect.left * scale
      const top = windowPosition.y + rect.top * scale
      const width = rect.width * scale
      const height = rect.height * scale
      return x >= left && x <= left + width && y >= top && y <= top + height
    }

    function applyCursorPosition(x: number, y: number): void {
      const inElement = isCursorInElement(x, y)
      if (inElement !== undefined)
        setIgnoreCursorEvents(!inElement)
    }

    // 启动后台鼠标流（CGEventTap / rdev）并强制一次即时同步，避免 CGEventTap
    // 静止光标不发事件导致的初始穿透死锁。query 先拿到光标再 flush windowPosition，
    // 保证 isCursorInElement 拿到坐标时 windowPosition 已就绪。
    //
    // 查询失败 / 返回 null 的兜底：Linux Wayland compositor 不允许 client 查询
    // 自己 surface 之外的光标位置（防按键记录），query 必返回 None。这种环境
    // 下 rdev 通常仍能拿到流事件，但静止光标首击无任何坐标可用——若维持
    // isIgnored=true（穿透），首击被吞、桌宠永远拖不动。退化到 clickable
    // （ignore=false）虽然会让桌宠拦截非命中区点击，但保证基础交互可用。
    void invoke('start_pet_mouse_stream').catch(() => {})
    void refreshWindowPosition().then(async () => {
      if (disposed)
        return
      try {
        const position = await invoke<DeviceMousePosition | null>('query_pet_cursor_position')
        if (disposed)
          return
        if (position !== null)
          applyCursorPosition(position.x, position.y)
        else
          setIgnoreCursorEvents(false)
      }
      catch {
        // 查询抛出异常时同样降级到 clickable，避免永远卡在穿透层。
        setIgnoreCursorEvents(false)
      }
    })

    const movedPromise = appWindow.onMoved(() => {
      void refreshWindowPosition().then(async () => {
        if (disposed)
          return
        try {
          const position = await invoke<DeviceMousePosition | null>('query_pet_cursor_position')
          if (!disposed && position !== null)
            applyCursorPosition(position.x, position.y)
        }
        catch {
          // ignore — 鼠标流后续会再同步
        }
      })
    })
    const resizedPromise = appWindow.onResized(() => {
      void refreshWindowPosition()
    })
    const mouseMovePromise = listen<DeviceMousePosition>('device-mouse-move', ({ payload }) => {
      applyCursorPosition(payload.x, payload.y)
    })

    void Promise.all([movedPromise, resizedPromise, mouseMovePromise]).then(([moved, resized, mouseMove]) => {
      if (disposed) {
        moved()
        resized()
        mouseMove()
      }
      else {
        unlistenMoved = moved
        unlistenResized = resized
        unlistenMouseMove = mouseMove
      }
    }).catch(() => {})

    return () => {
      disposed = true
      geometryRevision++
      unlistenMoved?.()
      unlistenResized?.()
      unlistenMouseMove?.()
    }
  }, [elementRef])
}
