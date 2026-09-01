import { describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import { initializeCodexAppServerConnection } from './codex-app-server-handshake'
import type { CodexAppServerConnection } from './codex-app-server-connection-types'

describe('initializeCodexAppServerConnection', () => {
  it('advertises the HiveCode title while preserving the app-server client identifier', async () => {
    const request = vi.fn().mockResolvedValue({})
    const notify = vi.fn()

    await initializeCodexAppServerConnection({
      request,
      notify
    } as unknown as CodexAppServerConnection)

    expect(request).toHaveBeenCalledWith(
      'initialize',
      expect.objectContaining({
        clientInfo: { name: 'orca_desktop', title: APP_DISPLAY_NAME, version: '0.0.0' }
      }),
      { timeoutMs: 15_000 }
    )
    expect(notify).toHaveBeenCalledWith('initialized')
  })
})
