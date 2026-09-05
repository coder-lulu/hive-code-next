import { describe, expect, it, vi } from 'vitest'
import { WORKTREE_GITHUB_PR_SUPPRESSION_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import { routeWebRuntimeConnectionFrame } from './web-runtime-connection-frame-router'
import { createWebRuntimeTestSession } from './web-runtime-e2ee-test-peer'

describe('web runtime connection capability advertisement', () => {
  it('advertises GitHub PR suppression during E2EE authentication', async () => {
    const sendEncrypted = vi.fn(() => true)
    const session = createWebRuntimeTestSession(false)

    await routeWebRuntimeConnectionFrame(JSON.stringify(session.server.ready), undefined, {
      getState: () => 'handshaking',
      getSession: () => session.client,
      getSocket: () => null,
      pairingToken: 'token',
      pending: new Map(),
      subscriptions: new Map(),
      sendEncrypted,
      setConnected: vi.fn(),
      setAuthFailed: vi.fn(),
      rejectUnauthorized: vi.fn(),
      notifyUnauthorized: vi.fn()
    })

    expect(sendEncrypted).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'e2ee_auth',
        clientCapabilities: expect.arrayContaining([
          WORKTREE_GITHUB_PR_SUPPRESSION_RUNTIME_CAPABILITY
        ])
      })
    )
  })
})
