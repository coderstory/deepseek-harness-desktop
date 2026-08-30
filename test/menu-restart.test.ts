import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const builderSource = readFileSync(
  new URL('../src-tauri/src/desktop/builder.rs', import.meta.url),
  'utf8',
)
const i18nSource = readFileSync(
  new URL('../src-tauri/src/config/i18n.rs', import.meta.url),
  'utf8',
)
const hookSource = readFileSync(
  new URL('../src/layout/components/use-macos-app-menu.ts', import.meta.url),
  'utf8',
)
const navbarSource = readFileSync(
  new URL('../src/layout/components/navbar.tsx', import.meta.url),
  'utf8',
)

describe('menu restart backend contract', () => {
  it('places desktop-restart menu item after run_logs in help submenu', () => {
    expect(builderSource).toContain('&run_logs, &restart, &check_update')
  })

  it('emits macos-menu-action for desktop-restart in on_menu_event', () => {
    expect(builderSource).toContain('desktop-restart')
    expect(builderSource).toContain('desktop-copy-run-logs')
  })

  it('provides menu.restart i18n key with zh/en translations', () => {
    expect(i18nSource).toContain('"menu.restart"')
    expect(i18nSource).toContain('"重启"')
  })
})

describe('menu restart frontend contract', () => {
  it('exposes restartHarness in MacOSAppMenuActions interface', () => {
    expect(hookSource).toContain('restartHarness: () => void')
  })

  it('dispatches desktop-restart to actionsRef.current.restartHarness()', () => {
    expect(hookSource).toContain('desktop-restart')
    expect(hookSource).toContain('actionsRef.current.restartHarness()')
  })

  it('wires restartHarness to store.harness.restart in navbar', () => {
    expect(navbarSource).toContain('restartHarness:')
    expect(navbarSource).toContain('store.harness.restart')
  })
})
