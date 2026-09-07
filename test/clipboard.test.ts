import { readFileSync } from 'node:fs'
import { invoke } from '@tauri-apps/api/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeClipboardText } from '../src/utils/clipboard'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const CLIPBOARD_CALL_SITES = [
  '../src/components/config-debug.tsx',
  '../src/layout/components/navbar.tsx',
  '../src/layout/components/preinstall-setup.tsx',
  '../src/layout/components/setup.tsx',
]

describe('clipboard integration', () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('routes every shell copy action through the native helper and handles failures', () => {
    for (const path of CLIPBOARD_CALL_SITES) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      expect(source).not.toContain('navigator.clipboard.writeText')

      const nativeWrite = source.indexOf('writeClipboardText(')
      expect(nativeWrite).toBeGreaterThan(-1)

      const failurePath = source.slice(nativeWrite, nativeWrite + 500)
      expect(failurePath).toContain('catch (err)')
      expect(failurePath).toContain('messages.logs_copy_failed')
    }
  })

  it('writes the exact text through the native clipboard command', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined as never)

    await expect(writeClipboardText('diagnostic logs')).resolves.toBeUndefined()

    expect(invoke).toHaveBeenCalledExactlyOnceWith('write_clipboard_text', { text: 'diagnostic logs' })
  })

  it('propagates native clipboard failures to the caller', async () => {
    const failure = new Error('clipboard unavailable')
    vi.mocked(invoke).mockRejectedValue(failure)

    await expect(writeClipboardText('diagnostic logs')).rejects.toBe(failure)
  })
})
