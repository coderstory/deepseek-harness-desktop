import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('navbar arrow hide (SYST-02)', () => {
  it('conditionally renders back button only when canGoBack on macOS', () => {
    const source = readFileSync(
      new URL('../src/layout/components/navbar.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toMatch(/<If[^>]*cond=\{IS_MACOS\s*&&\s*canGoBack\}[^>]*>/)
  })

  it('conditionally renders forward button only when canGoForward on macOS', () => {
    const source = readFileSync(
      new URL('../src/layout/components/navbar.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toMatch(/<If[^>]*cond=\{IS_MACOS\s*&&\s*canGoForward\}[^>]*>/)
  })

  it('removes isDisabled from arrow buttons (hide, not disable)', () => {
    const source = readFileSync(
      new URL('../src/layout/components/navbar.tsx', import.meta.url),
      'utf8',
    )
    expect(source).not.toMatch(/isDisabled=\{!canGoBack\}/)
    expect(source).not.toMatch(/isDisabled=\{!canGoForward\}/)
  })

  it('does not touch window control buttons', () => {
    const source = readFileSync(
      new URL('../src/layout/components/navbar.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain('handleWindowAction(\'minimize\')')
    expect(source).toContain('handleWindowAction(\'maximize\')')
    expect(source).toContain('handleWindowAction(\'background\')')
  })

  it('keeps sidebar toggle visible regardless of history', () => {
    const source = readFileSync(
      new URL('../src/layout/components/navbar.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toMatch(/onPress=\{\(\) => \{ sendNav\('sidebar:toggle'\) \}\}/)
    expect(source).not.toMatch(/canGoBack.*sidebar|sidebar.*canGoBack/)
  })

  it('stays within shell conventions', () => {
    const source = readFileSync(
      new URL('../src/layout/components/navbar.tsx', import.meta.url),
      'utf8',
    )
    expect(source).not.toContain('useCallback')
    expect(source).not.toContain('useMemo')
    expect(source).toContain('react-if-lite')
  })

  it('keeps aria-labels for accessibility', () => {
    const source = readFileSync(
      new URL('../src/layout/components/navbar.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain('aria-label={t(\'nav.back\')}')
    expect(source).toContain('aria-label={t(\'nav.forward\')}')
  })
})
