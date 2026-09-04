import { describe, expect, it } from 'vitest'
import { activityBubble, mapPetActivity } from './activity'

describe('mapPetActivity', () => {
  it('follows the Codex reference state precedence', () => {
    const summary = { id: 'session', running: true, completed: true }
    const session = { running: true, lastAgentError: 'boom' }
    expect(mapPetActivity(summary, session, { kind: 'question' })).toBe('waiting')
    expect(mapPetActivity(summary, session, undefined)).toBe('running')
    expect(mapPetActivity({ ...summary, running: false }, { ...session, running: false }, undefined)).toBe('review')
    expect(mapPetActivity({ id: 'session' }, { running: false, lastAgentError: 'boom' }, undefined)).toBe('failed')
    expect(mapPetActivity({ id: 'session' }, { running: false, lastAgentError: null }, undefined)).toBe('idle')
  })
})

describe('activityBubble', () => {
  it('includes context for non-idle states and clears idle bubbles', () => {
    expect(activityBubble('running', 'Running', 'Fix tests')).toBe('Running: Fix tests')
    expect(activityBubble('waiting', 'Waiting')).toBe('Waiting')
    expect(activityBubble('idle', 'Idle', 'Done')).toBeUndefined()
  })

  it('truncates long Unicode titles to the bridge-safe bubble limit', () => {
    const bubble = activityBubble('running', '运行中', '鲸'.repeat(200))
    expect(Array.from(bubble ?? '')).toHaveLength(120)
    expect(bubble?.startsWith('运行中: ')).toBe(true)
  })
})
