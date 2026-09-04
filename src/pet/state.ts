// 桌宠状态机的纯逻辑：集中维护状态、素材与循环方式，便于独立测试。

export const PET_ACTIVITIES = [
  'idle',
  'turn',
  'moving-left',
  'moving-right',
  'waving',
  'waiting',
  'running',
  'review',
  'failed',
] as const

export type PetActivity = (typeof PET_ACTIVITIES)[number]
export type PetFacing = 'left' | 'right'
export type PetAnimation = PetActivity | 'bubble'
export type PetAssetName
  = | 'maid-idle.webm'
    | 'maid-turn.webm'
    | 'maid-move.webm'
    | 'maid-wave.webm'
    | 'maid-waiting.webm'
    | 'maid-running.webm'
    | 'maid-review.webm'
    | 'maid-failed.webm'
    | 'maid-bubble.webm'

export interface PetVisual {
  asset: PetAssetName
  facing: PetFacing
  loop: boolean
}

export interface SpriteFrame {
  column: number
  duration: number
  row: number
}

export interface SpriteSequence {
  frames: SpriteFrame[]
  loopStart: number | null
}

const PET_ACTIVITY_SET = new Set<string>(PET_ACTIVITIES)
const SPRITE_ACTION_REPEATS = 3
const SPRITE_IDLE_DURATIONS = [280, 110, 110, 140, 140, 320] as const
const SPRITE_IDLE_SLOWDOWN = 6
const SPRITE_ANIMATIONS: Record<Exclude<PetAnimation, 'idle' | 'turn' | 'bubble'>, {
  duration: number
  frames: number
  lastDuration: number
  row: number
}> = {
  'moving-right': { row: 1, frames: 8, duration: 120, lastDuration: 220 },
  'moving-left': { row: 2, frames: 8, duration: 120, lastDuration: 220 },
  'waving': { row: 3, frames: 4, duration: 140, lastDuration: 280 },
  'failed': { row: 5, frames: 8, duration: 140, lastDuration: 240 },
  'waiting': { row: 6, frames: 6, duration: 150, lastDuration: 260 },
  'running': { row: 7, frames: 6, duration: 120, lastDuration: 220 },
  'review': { row: 8, frames: 6, duration: 150, lastDuration: 280 },
}

/** 把事件中的未知活动收敛到可验证的桌宠状态。 */
export function normalizePetActivity(value: unknown): PetActivity {
  if (typeof value === 'string' && PET_ACTIVITY_SET.has(value))
    return value as PetActivity
  return 'idle'
}

/** 根据活动给出唯一素材、循环方式与朝向。 */
export function getPetVisual(activity: PetAnimation, currentFacing: PetFacing): PetVisual {
  switch (activity) {
    case 'turn':
      return { asset: 'maid-turn.webm', loop: false, facing: currentFacing }
    case 'moving-left':
      return { asset: 'maid-move.webm', loop: true, facing: 'left' }
    case 'moving-right':
      return { asset: 'maid-move.webm', loop: true, facing: 'right' }
    case 'waving':
      return { asset: 'maid-wave.webm', loop: false, facing: currentFacing }
    case 'waiting':
      return { asset: 'maid-waiting.webm', loop: true, facing: currentFacing }
    case 'running':
      return { asset: 'maid-running.webm', loop: true, facing: currentFacing }
    case 'review':
      return { asset: 'maid-review.webm', loop: true, facing: currentFacing }
    case 'failed':
      return { asset: 'maid-failed.webm', loop: true, facing: currentFacing }
    case 'bubble':
      return { asset: 'maid-bubble.webm', loop: false, facing: currentFacing }
    case 'idle':
    default:
      return { asset: 'maid-idle.webm', loop: true, facing: currentFacing }
  }
}

/** 构造 Codex v2 精灵图序列：动作重复三次后进入慢速 idle 循环。 */
export function getSpriteSequence(
  activity: PetAnimation,
  facing: PetFacing,
  reducedMotion: boolean,
): SpriteSequence {
  const idleFrames = SPRITE_IDLE_DURATIONS.map((duration, column) => ({
    column,
    duration: duration * SPRITE_IDLE_SLOWDOWN,
    row: 0,
  }))
  const action = getSpriteAction(activity, facing)
  if (reducedMotion)
    return { frames: [action[0]], loopStart: null }
  if (activity === 'idle')
    return { frames: idleFrames, loopStart: 0 }

  const repeated: SpriteFrame[] = []
  for (let repeat = 0; repeat < SPRITE_ACTION_REPEATS; repeat += 1)
    repeated.push(...action)
  return { frames: [...repeated, ...idleFrames], loopStart: repeated.length }
}

/** 将逻辑帧换算成 CSS 精灵图百分比坐标。 */
export function getSpriteFramePosition(frame: SpriteFrame, columns: number, rows: number): string {
  const lastColumn = Math.max(1, columns - 1)
  const lastRow = Math.max(1, rows - 1)
  return `${frame.column * 100 / lastColumn}% ${frame.row * 100 / lastRow}%`
}

function getSpriteAction(activity: PetAnimation, facing: PetFacing): SpriteFrame[] {
  if (activity === 'idle') {
    return SPRITE_IDLE_DURATIONS.map((duration, column) => ({ column, duration, row: 0 }))
  }

  const mappedActivity = activity === 'turn'
    ? (facing === 'left' ? 'moving-right' : 'moving-left')
    : activity === 'bubble'
      ? 'waving'
      : activity
  const animation = SPRITE_ANIMATIONS[mappedActivity]
  return Array.from({ length: animation.frames }, (_, column) => ({
    column,
    duration: column === animation.frames - 1 ? animation.lastDuration : animation.duration,
    row: animation.row,
  }))
}
