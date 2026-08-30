import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('configFontFamily component contract', () => {
  it('exports the ConfigFontFamily function', () => {
    const source = readFileSync(new URL('../src/components/config-font-family.tsx', import.meta.url), 'utf8')
    expect(source).toContain('export function ConfigFontFamily')
  })

  it('invokes update_app_config with a camelCase fontFamily payload', () => {
    const source = readFileSync(new URL('../src/components/config-font-family.tsx', import.meta.url), 'utf8')
    expect(source).toContain('invoke<AppConfig>(\'update_app_config\', { fontFamily')
  })

  it('normalizes the font family value on the frontend', () => {
    const source = readFileSync(new URL('../src/components/config-font-family.tsx', import.meta.url), 'utf8')
    expect(source).toContain('normalizeFontFamily')
  })

  it('broadcasts font changes via a dsh-font-family-change CustomEvent', () => {
    const source = readFileSync(new URL('../src/components/config-font-family.tsx', import.meta.url), 'utf8')
    expect(source).toContain('dsh-font-family-change')
  })

  it('renders the i18n label', () => {
    const source = readFileSync(new URL('../src/components/config-font-family.tsx', import.meta.url), 'utf8')
    expect(source).toContain('ui.font_family')
  })

  it('stays within the React 19 compiler conventions', () => {
    const source = readFileSync(new URL('../src/components/config-font-family.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('useCallback')
    expect(source).not.toContain('useMemo')
  })

  it('does not use navigator.clipboard', () => {
    const source = readFileSync(new URL('../src/components/config-font-family.tsx', import.meta.url), 'utf8')
    expect(source).not.toContain('navigator.clipboard')
  })
})

describe('webview.tsx font-family bridge contract', () => {
  it('listens for dsh-font-family-change and forwards postMessage to iframe', () => {
    const source = readFileSync(new URL('../src/layout/components/webview.tsx', import.meta.url), 'utf8')
    expect(source).toContain('dsh-font-family-change')
    expect(source).toContain('dsh://font-family:update')
    expect(source).toContain('getIframeOrigin')
  })
})
