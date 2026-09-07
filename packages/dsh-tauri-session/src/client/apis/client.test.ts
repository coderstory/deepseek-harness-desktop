import { describe, expect, it, vi } from 'vitest'
import { postOpenSessionDir } from './client'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))

vi.mock('dsh-tauri/client', () => ({
  createJsonClient: vi.fn(() => ({ request: vi.fn(), post: postMock })),
  createExternalStore: vi.fn(() => ({ subscribe: vi.fn(), getSnapshot: vi.fn(), set: vi.fn() })),
}))

describe('postOpenSessionDir', () => {
  it('posts the session id to the session open-path route', async () => {
    postMock.mockResolvedValue({ ok: true })

    await expect(postOpenSessionDir('s1')).resolves.toEqual({ ok: true })
    expect(postMock).toHaveBeenCalledWith('/open-path', { sessionId: 's1' })
  })

  it('propagates a route failure so the panel can toast it', async () => {
    postMock.mockRejectedValue(new Error('session-directory-not-found'))

    await expect(postOpenSessionDir('missing')).rejects.toThrow('session-directory-not-found')
  })
})
