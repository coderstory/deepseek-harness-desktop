import { requestJson } from 'dsh-tauri/client'
import { describe, expect, it, vi } from 'vitest'
import { OPEN_PATH_ROUTE } from '../constants'
import { openInExplorer } from './open-path'

vi.mock('dsh-tauri/client', () => ({ requestJson: vi.fn() }))

const requestJsonMock = vi.mocked(requestJson)

describe('openInExplorer', () => {
  it('posts the directory to the plugin-owned open-path route', async () => {
    requestJsonMock.mockResolvedValue({ ok: true })

    await expect(openInExplorer('C:\\workspace')).resolves.toBeUndefined()
    expect(requestJsonMock).toHaveBeenCalledWith(OPEN_PATH_ROUTE, '', {
      method: 'POST',
      body: JSON.stringify({ path: 'C:\\workspace' }),
    })
  })

  it('surfaces the route error instead of a JSON SyntaxError', async () => {
    requestJsonMock.mockResolvedValue({ ok: false, error: 'not-a-directory' })

    await expect(openInExplorer('C:\\workspace')).rejects.toThrow('not-a-directory')
  })

  it('falls back to the generic error when the route reports no detail', async () => {
    requestJsonMock.mockResolvedValue({ ok: false })

    await expect(openInExplorer('C:\\workspace')).rejects.toThrow(/打开失败|Failed to open/)
  })
})
