import { describe, expect, it } from 'vitest'
import {
  CLOSE_ACTION_DEFAULT,
  CLOSE_ACTION_OPTIONS,
  normalizeCloseAction,
} from '../src/utils/close-action'

describe('close action normalization', () => {
  it('defaults to hiding in tray', () => {
    expect(CLOSE_ACTION_DEFAULT).toBe('tray')
  })

  it('exposes exactly the tray and quit options', () => {
    expect(CLOSE_ACTION_OPTIONS).toEqual(['tray', 'quit'])
  })

  it('keeps the two supported literal values', () => {
    expect(normalizeCloseAction('tray')).toBe('tray')
    expect(normalizeCloseAction('quit')).toBe('quit')
  })

  it('falls back to tray for anything outside the whitelist', () => {
    expect(normalizeCloseAction(undefined)).toBe('tray')
    expect(normalizeCloseAction(null)).toBe('tray')
    expect(normalizeCloseAction('')).toBe('tray')
    expect(normalizeCloseAction('TRAY')).toBe('tray')
    expect(normalizeCloseAction('bogus')).toBe('tray')
    expect(normalizeCloseAction({})).toBe('tray')
  })
})
