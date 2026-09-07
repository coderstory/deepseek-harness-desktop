import { describe, expect, it } from 'vitest'
import { progressPercent, resolvePresetCardAction } from './preset-card'

function progress(phase: PresetDownloadPhase, received = 0, total = 0): { phase: PresetDownloadPhase, received: number, total: number, error?: string | null } {
  return { phase, received, total }
}

type PresetDownloadPhase = 'idle' | 'downloading' | 'extracting' | 'done' | 'failed'

describe('resolvePresetCardAction', () => {
  const maid = { id: 'maid-deepseek-whale', installed: false, phase: 'idle' as const }

  it('已选优先于下载/启用状态', () => {
    expect(resolvePresetCardAction(maid, 'maid-deepseek-whale', progress('downloading'))).toBe('selected')
    expect(resolvePresetCardAction({ ...maid, installed: true }, 'maid-deepseek-whale', null)).toBe('selected')
  })

  it('下载/解压中显示 downloading，不因已安装而跳到 enable', () => {
    expect(resolvePresetCardAction(maid, 'other', progress('downloading'))).toBe('downloading')
    expect(resolvePresetCardAction(maid, 'other', progress('extracting'))).toBe('downloading')
    expect(resolvePresetCardAction({ ...maid, installed: true }, 'other', progress('downloading'))).toBe('downloading')
  })

  it('无轮询进度时用清单 phase 恢复下载中视图（跨挂载场景）', () => {
    expect(resolvePresetCardAction({ ...maid, phase: 'downloading' }, 'other', null)).toBe('downloading')
    expect(resolvePresetCardAction({ ...maid, phase: 'extracting' }, 'other', null)).toBe('downloading')
    expect(resolvePresetCardAction({ ...maid, phase: 'done' }, 'other', null)).toBe('download')
    expect(resolvePresetCardAction({ ...maid, phase: 'failed' }, 'other', null)).toBe('download')
  })

  it('已安装且非当前 → enable；未安装 → download', () => {
    expect(resolvePresetCardAction({ ...maid, installed: true }, 'other', null)).toBe('enable')
    expect(resolvePresetCardAction(maid, 'other', null)).toBe('download')
    expect(resolvePresetCardAction(maid, 'other', progress('done'))).toBe('download')
    expect(resolvePresetCardAction(maid, 'other', progress('failed'))).toBe('download')
  })
})

describe('progressPercent', () => {
  it('已知总量返回截断百分比', () => {
    expect(progressPercent(progress('downloading', 50, 200))).toBe(25)
    expect(progressPercent(progress('downloading', 200, 200))).toBe(100)
    expect(progressPercent(progress('downloading', 300, 200))).toBe(100)
  })

  it('未知总量：下载早期与解压中均返回 null（不确定进度）', () => {
    expect(progressPercent(progress('downloading'))).toBeNull()
    expect(progressPercent(progress('extracting'))).toBeNull()
    expect(progressPercent(progress('idle'))).toBe(0)
  })
})
