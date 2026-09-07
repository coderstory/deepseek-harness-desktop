import { describe, expect, it } from 'vitest'
import { PET_REASONING_TAIL_LENGTH } from '../constants'
import { foldSessionActivity } from './activity'

/** 构造窗口条目：离散事件信封 `{ type:'event', event }`。 */
function ev(type: string, data: Record<string, unknown> = {}): unknown {
  return { type: 'event', event: { type, seq: 0, time: 0, data } }
}

/** 构造窗口条目：打包 chunk 行信封 `{ type:'chunks', event }`。 */
function chunks(type: string, data: Record<string, unknown>): unknown {
  return { type: 'chunks', event: { type, seq: 0, time: 0, data } }
}

describe('foldSessionActivity', () => {
  it('returns null for an empty window', () => {
    expect(foldSessionActivity([])).toBeNull()
  })

  it('ignores foreign events and non-object entries', () => {
    const entries = [
      null,
      'raw',
      42,
      ev('sandbox/mode', { mode: 'workspace-write' }),
      ev('approval/policy', { policy: 'ask' }),
    ]
    expect(foldSessionActivity(entries)).toBeNull()
  })

  it('folds a running reasoning block from packed rows and keeps the tail window', () => {
    const entries = [
      ev('step/start', { turn: 1, step: 1 }),
      chunks('chunkrow/reasoning-chunks', { turn: 1, step: 1, index: 0, dt: [], texts: ['alpha', ' beta ', 'gamma'] }),
      chunks('chunkrow/reasoning-chunks', { turn: 1, step: 1, index: 0, dt: [], texts: [' more'] }),
    ]
    expect(foldSessionActivity(entries)).toEqual({ kind: 'reasoning', text: 'alpha beta gamma more' })
  })

  it('a new reasoning block index restarts the buffer', () => {
    const entries = [
      chunks('chunkrow/reasoning-chunks', { turn: 1, step: 1, index: 0, dt: [], texts: ['old reasoning'] }),
      chunks('chunkrow/reasoning-chunks', { turn: 1, step: 2, index: 1, dt: [], texts: ['new reasoning'] }),
    ]
    expect(foldSessionActivity(entries)).toEqual({ kind: 'reasoning', text: 'new reasoning' })
  })

  it('truncates reasoning text to the tail window', () => {
    const text = 'a'.repeat(PET_REASONING_TAIL_LENGTH + 20)
    const entries = [
      chunks('chunkrow/reasoning-chunks', { turn: 1, step: 1, index: 0, dt: [], texts: [text] }),
      chunks('chunkrow/reasoning-chunks', { turn: 1, step: 1, index: 0, dt: [], texts: ['bbb'] }),
    ]
    const activity = foldSessionActivity(entries)
    expect(activity?.kind).toBe('reasoning')
    expect(activity?.text).toBe(`${'a'.repeat(PET_REASONING_TAIL_LENGTH - 3)}bbb`)
  })

  it('raw block-start opens and block-end closes reasoning', () => {
    const open = [
      ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } }),
      ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'delta' } }),
    ]
    expect(foldSessionActivity(open)).toEqual({ kind: 'reasoning', text: 'delta' })
    expect(foldSessionActivity([...open, ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 0 } })])).toBeNull()
  })

  it('prefers an in-flight tool call over reasoning', () => {
    const entries = [
      ev('step/start', { turn: 1, step: 1 }),
      chunks('chunkrow/reasoning-chunks', { turn: 1, step: 1, index: 0, dt: [], texts: ['think'] }),
      ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 0 } }),
      ev('tool/call', { callId: 'call-1', name: 'pwsh', arguments: '{"command":"ls"}' }),
    ]
    expect(foldSessionActivity(entries)).toEqual({ kind: 'tool', name: 'pwsh', args: '{"command":"ls"}' })
  })

  it('tool/result closes the tool state', () => {
    const entries = [
      ev('tool/call', { callId: 'call-1', name: 'pwsh', arguments: '{"command":"ls"}' }),
      ev('tool/result', { message: { source: { callId: 'call-1' } }, content: [] }),
    ]
    expect(foldSessionActivity(entries)).toBeNull()
  })

  it('streaming tool-call chunks produce a tool activity with joined args', () => {
    const entries = [chunks('chunkrow/tool-call-chunks', { turn: 1, step: 1, index: 0, id: 'call-1', name: 'pwsh', dt: [], args: ['{"com', 'mand":"ls"}'] })]
    expect(foldSessionActivity(entries)).toEqual({ kind: 'tool', name: 'pwsh', args: '{"command":"ls"}' })
  })

  it('step/turn boundaries clear stale activity', () => {
    const entries = [
      chunks('chunkrow/reasoning-chunks', { turn: 1, step: 1, index: 0, dt: [], texts: ['stale'] }),
      ev('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(foldSessionActivity(entries)).toBeNull()
  })

  it('plain text output is not an activity', () => {
    const entries = [chunks('chunkrow/text-chunks', { turn: 1, step: 1, index: 1, dt: [], texts: ['the', ' answer'] })]
    expect(foldSessionActivity(entries)).toBeNull()
  })

  it('accepts bare SessionEvents as well as window envelopes', () => {
    const bare = [{ type: 'tool/call', seq: 1, time: 0, data: { callId: 'c', name: 'read', arguments: '{"file_path":"a.ts"}' } }]
    expect(foldSessionActivity(bare)).toEqual({ kind: 'tool', name: 'read', args: '{"file_path":"a.ts"}' })
  })
})
