import { describe, expect, it } from 'vitest'
import { parseJsonResponse } from './client'

describe('parseJsonResponse', () => {
  it('decodes a JSON response body', () => {
    expect(parseJsonResponse('{"ok":true}')).toEqual({ ok: true })
  })

  it('preserves a legacy plain-text error body for error normalization', () => {
    expect(parseJsonResponse('not found')).toBe('not found')
  })

  it('returns undefined for an empty body', () => {
    expect(parseJsonResponse('')).toBeUndefined()
  })
})
