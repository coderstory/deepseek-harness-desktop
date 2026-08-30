import { describe, expect, it } from 'vitest'
import { FONT_FAMILY_DEFAULT, normalizeFontFamily } from '../src/utils/font-family'

describe('font family normalization', () => {
  it('defaults to an empty string (no override)', () => {
    expect(FONT_FAMILY_DEFAULT).toBe('')
  })

  it('keeps valid font family names', () => {
    expect(normalizeFontFamily('PingFang SC')).toBe('PingFang SC')
    expect(normalizeFontFamily('SF Mono')).toBe('SF Mono')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeFontFamily('  PingFang SC  ')).toBe('PingFang SC')
  })

  it('falls back to default for empty or whitespace-only input', () => {
    expect(normalizeFontFamily('')).toBe('')
    expect(normalizeFontFamily('   ')).toBe('')
    expect(normalizeFontFamily('\t\n')).toBe('')
  })

  it('falls back to default for non-string input', () => {
    expect(normalizeFontFamily(undefined)).toBe('')
    expect(normalizeFontFamily(null)).toBe('')
    expect(normalizeFontFamily(123)).toBe('')
    expect(normalizeFontFamily({})).toBe('')
  })

  it('rejects CSS injection characters', () => {
    for (const raw of ['{', '}', ';', '(', ')', '<', '\\', 'a{b}', 'x;y', 'font\\']) {
      expect(normalizeFontFamily(raw), `含 CSS 元字符的输入 ${raw} 应回落默认`).toBe('')
    }
  })
})
