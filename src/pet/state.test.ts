import { describe, expect, it } from 'vitest'
import {
  getPetVisual,
  getSpriteFramePosition,
  getSpriteSequence,
  normalizePetActivity,
} from './state'

describe('normalizePetActivity', () => {
  it('保留协议内状态并把未知值收敛为空闲', () => {
    expect(normalizePetActivity('running')).toBe('running')
    expect(normalizePetActivity('moving-right')).toBe('moving-right')
    expect(normalizePetActivity('unknown')).toBe('idle')
    expect(normalizePetActivity(null)).toBe('idle')
  })
})

describe('getPetVisual', () => {
  it('将移动状态映射到共享素材和对应朝向', () => {
    expect(getPetVisual('moving-left', 'right')).toEqual({
      asset: 'maid-move.webm',
      loop: true,
      facing: 'left',
    })
    expect(getPetVisual('moving-right', 'left')).toEqual({
      asset: 'maid-move.webm',
      loop: true,
      facing: 'right',
    })
  })

  it('仅让一次性动作停止循环', () => {
    expect(getPetVisual('turn', 'left').loop).toBe(false)
    expect(getPetVisual('waving', 'left').loop).toBe(false)
    expect(getPetVisual('bubble', 'left').loop).toBe(false)
    expect(getPetVisual('waiting', 'left').loop).toBe(true)
    expect(getPetVisual('running', 'left').loop).toBe(true)
  })
})

describe('getSpriteSequence', () => {
  it('按 v2 行号映射动作并在三轮后进入慢速 idle', () => {
    const sequence = getSpriteSequence('running', 'left', false)
    expect(sequence.frames).toHaveLength(24)
    expect(sequence.loopStart).toBe(18)
    expect(sequence.frames[0]).toEqual({ column: 0, duration: 120, row: 7 })
    expect(sequence.frames[17]).toEqual({ column: 5, duration: 220, row: 7 })
    expect(sequence.frames[18]).toEqual({ column: 0, duration: 1_680, row: 0 })
  })

  it('左右移动使用独立行且降低动态效果时只保留首帧', () => {
    expect(getSpriteSequence('moving-right', 'left', true).frames[0].row).toBe(1)
    expect(getSpriteSequence('moving-left', 'right', true).frames[0].row).toBe(2)
    expect(getSpriteSequence('bubble', 'left', true).frames[0].row).toBe(3)
  })

  it('将 8x11 网格帧换算为百分比坐标', () => {
    expect(getSpriteFramePosition({ column: 7, duration: 120, row: 10 }, 8, 11)).toBe('100% 100%')
  })
})
