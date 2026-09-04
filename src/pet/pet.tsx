import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type {
  PetActivity,
  PetAnimation,
  PetAssetName,
  PetFacing,
} from './state'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import { If } from 'react-if-lite'
import { toast } from '@/utils/toast'
import bubbleVideoUrl from '../../packages/dsh-tauri-pet/assets/maid-bubble.webm'
import whaleFallbackUrl from '../../packages/dsh-tauri-pet/assets/maid-deepseek-whale.gif'
import failedVideoUrl from '../../packages/dsh-tauri-pet/assets/maid-failed.webm'
import idleVideoUrl from '../../packages/dsh-tauri-pet/assets/maid-idle.webm'
import moveVideoUrl from '../../packages/dsh-tauri-pet/assets/maid-move.webm'
import reviewVideoUrl from '../../packages/dsh-tauri-pet/assets/maid-review.webm'
import runningVideoUrl from '../../packages/dsh-tauri-pet/assets/maid-running.webm'
import turnVideoUrl from '../../packages/dsh-tauri-pet/assets/maid-turn.webm'
import waitingVideoUrl from '../../packages/dsh-tauri-pet/assets/maid-waiting.webm'
import waveVideoUrl from '../../packages/dsh-tauri-pet/assets/maid-wave.webm'
import {
  getPetVisual,
  getSpriteFramePosition,
  getSpriteSequence,
  normalizePetActivity,
} from './state'

interface PetStatus {
  enabled: boolean
  visible?: boolean | null
  active_pet?: string | null
  pet_size?: number | null
  activity?: unknown
  bubble?: unknown
}

interface PetAsset {
  columns: number
  id: string
  rows: number
  sprite_version_number: number
  spritesheet: string
}

interface DragState {
  active: boolean
  dragged: boolean
  nativeStarted: boolean
  pointerId: number
  requestId: number
  startPointer: { x: number, y: number }
}

interface Copy {
  petLabel: string
  shortHint: string
}

const BUILT_IN_PET_ID = 'maid-deepseek-whale'
const PET_DEFAULT_SIZE_PERCENT = 100
const PET_BASE_WIDTH = 220
const PET_STATUS_EVENT = 'pet://status'
const BUBBLE_DURATION_MS = 10_000
const DRAG_THRESHOLD_PX = 4
const CLICK_DELAY_MS = 220

const COPY: Record<'en' | 'zh', Copy> = {
  en: {
    petLabel: 'DeepSeek Harness desktop pet',
    shortHint: 'I am here. How is it going?',
  },
  zh: {
    petLabel: 'DeepSeek Harness 桌宠',
    shortHint: '我在呢，进展怎么样？',
  },
}

const ASSET_URLS: Record<PetAssetName, string> = {
  'maid-idle.webm': idleVideoUrl,
  'maid-turn.webm': turnVideoUrl,
  'maid-move.webm': moveVideoUrl,
  'maid-wave.webm': waveVideoUrl,
  'maid-waiting.webm': waitingVideoUrl,
  'maid-running.webm': runningVideoUrl,
  'maid-review.webm': reviewVideoUrl,
  'maid-failed.webm': failedVideoUrl,
  'maid-bubble.webm': bubbleVideoUrl,
}

/** 独立透明桌宠窗口：事件驱动状态、内置视频、自定义精灵图与无积压拖拽。 */
export function PetWindow() {
  const [status, setStatus] = useState<PetStatus>({ enabled: true })
  const [sessionActivity, setSessionActivity] = useState<PetActivity>('idle')
  const [localActivity, setLocalActivity] = useState<PetAnimation | null>(null)
  const [facing, setFacing] = useState<PetFacing>('left')
  const [failedPet, setFailedPet] = useState<string | null>(null)
  const [customAsset, setCustomAsset] = useState<PetAsset | null>(null)
  const [spriteAspect, setSpriteAspect] = useState<{ id: string, value: number } | null>(null)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const bubbleTimerRef = useRef<number | null>(null)
  const clickTimerRef = useRef<number | null>(null)
  const spriteRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState>({ active: false, dragged: false, nativeStarted: false, pointerId: -1, requestId: 0, startPointer: { x: 0, y: 0 } })
  const dragRequestRef = useRef(0)
  const activity = localActivity ?? sessionActivity
  const visual = getPetVisual(activity, facing)
  const activePet = normalizeActivePet(status.active_pet)
  const usesCustomSprite = activePet !== BUILT_IN_PET_ID
  const visibleCustomAsset = customAsset?.id === activePet ? customAsset : null
  const mediaFailed = failedPet === activePet
  const petSizePercent = normalizePetSize(status.pet_size)
  const copy = getCopy()
  const isVisible = status.enabled && status.visible !== false
  const petStyle = {
    '--pet-width': `${(PET_BASE_WIDTH * petSizePercent) / 100}px`,
    '--pet-scale': String(petSizePercent / 100),
    '--pet-facing': usesCustomSprite || visual.facing === 'left' ? '1' : '-1',
    '--pet-aspect': usesCustomSprite && spriteAspect?.id === activePet ? spriteAspect.value : (usesCustomSprite ? 1 : 9 / 16),
  } as CSSProperties

  // 初次读取一次持久化状态，随后完全依赖 pet://status 事件，不再轮询。
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined

    function applyStatus(nextStatus: PetStatus) {
      if (cancelled)
        return
      setStatus(nextStatus)
      setSessionActivity(normalizePetActivity(nextStatus.activity))
      const nextBubble = normalizeBubble(nextStatus.bubble)
      if (nextBubble)
        showBubble(nextBubble)
      else
        hideBubble()
    }

    void listen<PetStatus>(PET_STATUS_EVENT, (event) => {
      applyStatus(event.payload)
    }).then((unlisten) => {
      if (cancelled)
        unlisten()
      else
        dispose = unlisten
    }).catch((error) => {
      console.error('[pet] listen pet://status failed:', error)
    })

    void invoke<PetStatus>('get_pet_status').then(applyStatus).catch((error) => {
      console.error('[pet] get_pet_status failed:', error)
    })

    return () => {
      cancelled = true
      dispose?.()
    }
    // 仅在窗口首次挂载时建立事件通道；气泡函数通过 ref 定时器管理自身生命周期。
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  // active_pet 使用来源限定 id；只有内置默认宠物继续走 WebM 状态机。
  useEffect(() => {
    let cancelled = false
    if (!usesCustomSprite)
      return undefined

    void invoke<PetAsset>('get_pet_asset', { id: activePet }).then((asset) => {
      if (cancelled)
        return
      if (!isSupportedAsset(asset))
        throw new Error('PET_ASSET_INVALID: expected Codex v2 8x11 spritesheet')
      setFailedPet(null)
      setCustomAsset(asset)
    }).catch((error) => {
      if (!cancelled) {
        setFailedPet(activePet)
        console.error('[pet] get_pet_asset failed:', error)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activePet, usesCustomSprite])

  // 精灵图逐帧计时与参考实现一致，动作三轮后安全进入慢速 idle。
  useEffect(() => {
    const sprite = spriteRef.current
    if (!usesCustomSprite || visibleCustomAsset === null || sprite === null)
      return undefined
    const spriteElement = sprite
    const asset = visibleCustomAsset
    const sequence = getSpriteSequence(activity, facing, reducedMotion)
    let index = 0
    let timer: number | undefined

    function paint() {
      const current = sequence.frames[index]
      spriteElement.style.backgroundPosition = getSpriteFramePosition(current, asset.columns, asset.rows)
      spriteElement.dataset.petFrame = String(index)
      if (sequence.frames.length === 1)
        return
      timer = window.setTimeout(() => {
        const next = index + 1
        index = next >= sequence.frames.length ? (sequence.loopStart ?? index) : next
        paint()
      }, current.duration)
    }

    paint()
    return () => {
      if (timer !== undefined)
        window.clearTimeout(timer)
    }
  }, [activity, facing, reducedMotion, usesCustomSprite, visibleCustomAsset])

  // 一次性交互在精灵图中完整播放三轮后回到会话状态；turn 同时切换朝向。
  useEffect(() => {
    if (!usesCustomSprite || localActivity === null)
      return undefined
    const sequence = getSpriteSequence(localActivity, facing, reducedMotion)
    const actionLength = sequence.loopStart ?? sequence.frames.length
    const duration = sequence.frames.slice(0, actionLength).reduce((total, frame) => total + frame.duration, 0)
    const timer = window.setTimeout(() => {
      if (localActivity === 'turn')
        setFacing(current => current === 'left' ? 'right' : 'left')
      setLocalActivity(null)
    }, duration)
    return () => window.clearTimeout(timer)
  }, [facing, localActivity, reducedMotion, usesCustomSprite])

  // 跟随操作系统的降低动态效果偏好，自定义精灵图冻结在对应动作首帧。
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    function applyPreference() {
      setReducedMotion(query.matches)
    }
    query.addEventListener('change', applyPreference)
    return () => query.removeEventListener('change', applyPreference)
  }, [])

  // 气泡与点击任务在卸载时统一回收。
  useEffect(() => {
    return () => {
      clearBubbleTimer()
      clearClickTimer()
      toast.clear()
    }
  }, [])

  function clearBubbleTimer() {
    if (bubbleTimerRef.current !== null) {
      window.clearTimeout(bubbleTimerRef.current)
      bubbleTimerRef.current = null
    }
  }

  function clearClickTimer() {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
  }

  function hideBubble() {
    clearBubbleTimer()
    toast.clear()
  }

  function showBubble(text: string) {
    clearBubbleTimer()
    toast.clear()
    toast(text, { timeout: BUBBLE_DURATION_MS, placement: 'top' })
    bubbleTimerRef.current = window.setTimeout(() => {
      toast.clear()
      bubbleTimerRef.current = null
    }, BUBBLE_DURATION_MS)
  }

  function handleAnimationEnded() {
    if (activity === 'turn')
      setFacing(visual.facing === 'left' ? 'right' : 'left')
    if (localActivity !== null) {
      setLocalActivity(null)
      return
    }
    if (activity === 'turn' || activity === 'waving')
      setSessionActivity('idle')
  }

  function handleVideoError() {
    setFailedPet(activePet)
  }

  function handleMediaLoaded() {
    setFailedPet(null)
  }

  function handleSpriteLoaded(event: React.SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget
    if (visibleCustomAsset !== null) {
      const frameWidth = image.naturalWidth / visibleCustomAsset.columns
      const frameHeight = image.naturalHeight / visibleCustomAsset.rows
      if (frameWidth > 0 && frameHeight > 0)
        setSpriteAspect({ id: visibleCustomAsset.id, value: frameHeight / frameWidth })
    }
    handleMediaLoaded()
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0)
      return
    const requestId = dragRequestRef.current + 1
    dragRequestRef.current = requestId
    dragRef.current = {
      active: true,
      dragged: false,
      nativeStarted: true,
      pointerId: event.pointerId,
      requestId,
      startPointer: { x: event.screenX, y: event.screenY },
    }
    // 交给操作系统追踪窗口。Windows 原生拖拽会正确处理跨显示器 DPI 切换，
    // 不再把不同坐标系的 PointerEvent 增量换算成窗口物理像素。
    void performNativeDrag(requestId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag.active || drag.pointerId !== event.pointerId)
      return
    const stepX = event.screenX - drag.startPointer.x
    const stepY = event.screenY - drag.startPointer.y
    if (!drag.dragged && Math.hypot(stepX, stepY) < DRAG_THRESHOLD_PX)
      return
    drag.dragged = true
    if (stepX !== 0) {
      const nextFacing: PetFacing = stepX < 0 ? 'left' : 'right'
      setFacing(nextFacing)
      setLocalActivity(nextFacing === 'left' ? 'moving-left' : 'moving-right')
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag.active || drag.pointerId !== event.pointerId)
      return
    const totalX = event.screenX - drag.startPointer.x
    const totalY = event.screenY - drag.startPointer.y
    if (Math.hypot(totalX, totalY) >= DRAG_THRESHOLD_PX)
      drag.dragged = true
    // startDragging 的 Promise 在系统结束拖拽后负责区分点击与实际移动。
    if (!drag.nativeStarted)
      finishPetInteraction(false)
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (drag.pointerId !== event.pointerId)
      return
    drag.dragged = true
    setLocalActivity(null)
  }

  function handleDoubleClick() {
    dragRequestRef.current += 1
    dragRef.current.active = false
    clearClickTimer()
    setLocalActivity('bubble')
  }

  async function performNativeDrag(requestId: number) {
    const appWindow = getCurrentWindow()
    const originPromise = appWindow.outerPosition()
    try {
      const nativeDrag = appWindow.startDragging()
      const origin = await originPromise
      await nativeDrag
      const position = await appWindow.outerPosition()
      if (dragRequestRef.current !== requestId)
        return
      const moved = position.x !== origin.x || position.y !== origin.y
      finishPetInteraction(moved)
    }
    catch (error) {
      if (dragRequestRef.current === requestId)
        finishPetInteraction(false)
      console.warn('[pet] native drag failed:', error)
    }
  }

  function finishPetInteraction(moved: boolean) {
    const drag = dragRef.current
    drag.active = false
    drag.nativeStarted = false
    if (moved || drag.dragged) {
      setLocalActivity(null)
      return
    }
    clearClickTimer()
    clickTimerRef.current = window.setTimeout(() => {
      setLocalActivity('waving')
      if (!normalizeBubble(status.bubble))
        showBubble(copy.shortHint)
      clickTimerRef.current = null
    }, CLICK_DELAY_MS)
  }

  return (
    <main className="pet-stage" data-visible={isVisible}>
      <If cond={isVisible}>
        <div className="pet-anchor" style={petStyle} data-sprite={usesCustomSprite}>
          <div
            className="pet-hit-area"
            aria-label={copy.petLabel}
            data-activity={activity}
            data-active-pet={activePet}
            onDoubleClick={handleDoubleClick}
            onPointerCancel={handlePointerCancel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            role="img"
          >
            <If cond={!usesCustomSprite}>
              <video
                key={visual.asset}
                className="pet-video"
                data-facing={visual.facing}
                autoPlay
                loop={visual.loop}
                muted
                onEnded={handleAnimationEnded}
                onError={handleVideoError}
                onLoadedData={handleMediaLoaded}
                playsInline
                preload="auto"
                src={ASSET_URLS[visual.asset]}
              />
            </If>
            <If cond={usesCustomSprite && visibleCustomAsset !== null}>
              <div
                ref={spriteRef}
                className="pet-sprite"
                data-facing={facing}
                style={{
                  backgroundImage: visibleCustomAsset ? `url(${visibleCustomAsset.spritesheet})` : undefined,
                  backgroundPosition: visibleCustomAsset
                    ? getSpriteFramePosition(getSpriteSequence(activity, facing, reducedMotion).frames[0], visibleCustomAsset.columns, visibleCustomAsset.rows)
                    : undefined,
                  backgroundSize: visibleCustomAsset ? `${visibleCustomAsset.columns * 100}% ${visibleCustomAsset.rows * 100}%` : undefined,
                }}
              />
              <img
                className="pet-sprite-probe"
                src={visibleCustomAsset?.spritesheet}
                alt=""
                draggable={false}
                onError={handleVideoError}
                onLoad={handleSpriteLoaded}
              />
            </If>
            <If cond={mediaFailed}>
              <img className="pet-fallback" src={whaleFallbackUrl} alt="" draggable={false} />
            </If>
          </div>
        </div>
      </If>
    </main>
  )
}

function isSupportedAsset(value: PetAsset): boolean {
  return value.sprite_version_number === 2
    && value.columns === 8
    && value.rows === 11
    && typeof value.spritesheet === 'string'
    && value.spritesheet.length > 0
}

function normalizeActivePet(value: string | null | undefined): string {
  const normalized = value?.trim()
  return normalized || BUILT_IN_PET_ID
}

function normalizePetSize(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return PET_DEFAULT_SIZE_PERCENT
  return Math.min(200, Math.max(50, value))
}

function normalizeBubble(value: unknown): string {
  if (typeof value === 'string')
    return value.trim()
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string')
    return value.text.trim()
  return ''
}

function getCopy(): Copy {
  const language = document.documentElement.lang || navigator.language
  return language.toLowerCase().startsWith('zh') ? COPY.zh : COPY.en
}
