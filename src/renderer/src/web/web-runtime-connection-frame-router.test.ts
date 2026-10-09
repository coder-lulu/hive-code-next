import { describe, expect, it, vi } from 'vitest'
import {
  REPO_SEARCH_QUALIFIED_REFS_RUNTIME_CAPABILITY,
  WORKTREE_BACKGROUND_REMOVAL_RUNTIME_CAPABILITY,
  WORKTREE_GITHUB_PR_SUPPRESSION_RUNTIME_CAPABILITY
} from '../../../shared/protocol-version'
import { routeWebRuntimeConnectionFrame } from './web-runtime-connection-frame-router'
import { createWebRuntimeTestSession } from './web-runtime-e2ee-test-peer'
import { webRuntimeAuthenticationFrame } from './web-runtime-client-protocol'

describe('web runtime connection capability advertisement', () => {
  it('advertises GitHub PR suppression and the removing marker during E2EE authentication', async () => {
    const sendEncrypted = vi.fn(() => true)
    const session = createWebRuntimeTestSession(false)

    await routeWebRuntimeConnectionFrame(JSON.stringify(session.server.ready), undefined, {
      getState: () => 'handshaking',
      getSession: () => session.client,
      getSocket: () => null,
      authenticationFrame: () =>
        webRuntimeAuthenticationFrame(
          {
            kind: 'pairing',
            endpoint: 'ws://127.0.0.1',
            publicKeyB64: '',
            deviceToken: 'token'
          },
          session.client.transcriptHashB64
        ),
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
          REPO_SEARCH_QUALIFIED_REFS_RUNTIME_CAPABILITY,
          WORKTREE_GITHUB_PR_SUPPRESSION_RUNTIME_CAPABILITY,
          // The web client runs the desktop renderer, which shows Deleting from the marker.
          WORKTREE_BACKGROUND_REMOVAL_RUNTIME_CAPABILITY
        ])
      })
    )
  })
})
