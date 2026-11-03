import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REPO_SEARCH_QUALIFIED_REFS_RUNTIME_CAPABILITY,
  WORKTREE_BACKGROUND_REMOVAL_RUNTIME_CAPABILITY,
  WORKTREE_GITHUB_PR_SUPPRESSION_RUNTIME_CAPABILITY
} from '../../../shared/protocol-version'
import { createPairedE2EEClientHandshake } from '../../../shared/paired-e2ee-client-handshake'
import { DesktopMobileE2EEV2Session } from '../../../shared/runtime-e2ee-server-session'
import { WEB_PAIRED_E2EE_PRIMITIVES } from './web-paired-e2ee-primitives'
import {
  routeWebRuntimeConnectionFrame,
  sealWebRuntimeAuth
} from './web-runtime-connection-frame-router'

beforeEach(() => vi.stubGlobal('window', { atob, btoa }))
afterEach(() => vi.unstubAllGlobals())

describe('web runtime connection capability advertisement', () => {
  it('advertises GitHub PR suppression and the removing marker during E2EE authentication', async () => {
    const keys = WEB_PAIRED_E2EE_PRIMITIVES.generateKeyPair()
    const handshake = createPairedE2EEClientHandshake({
      primitives: WEB_PAIRED_E2EE_PRIMITIVES,
      hostPublicKeyB64: WEB_PAIRED_E2EE_PRIMITIVES.publicKeyToBase64(keys.publicKey),
      framing: 'v2',
      transport: 'direct'
    })
    const server = DesktopMobileE2EEV2Session.create({
      hello: JSON.parse(handshake.helloText()),
      serverSecretKey: keys.secretKey,
      expectedContext: { transport: 'direct' }
    })
    if (!server) throw new Error('Test server rejected handshake')
    let authFrame: Promise<string> | undefined
    const setConnected = vi.fn()
    const authRejected = vi.fn()
    await routeWebRuntimeConnectionFrame(JSON.stringify(server.ready), undefined, {
      getState: () => 'handshaking',
      getHandshake: () => handshake,
      getSocket: () => null,
      pending: new Map(),
      subscriptions: new Map(),
      sendAuth: (accepted) => {
        authFrame = sealWebRuntimeAuth(accepted, 'token')
      },
      setConnected,
      authRejected
    })
    if (!authFrame) throw new Error('Ready frame did not request authentication')
    const plaintext = server.openText(await authFrame)
    if (!plaintext) throw new Error('Server could not decrypt authentication')
    expect(JSON.parse(plaintext)).toMatchObject({
      type: 'e2ee_auth',
      deviceToken: 'token',
      clientCapabilities: expect.arrayContaining([
        REPO_SEARCH_QUALIFIED_REFS_RUNTIME_CAPABILITY,
        WORKTREE_GITHUB_PR_SUPPRESSION_RUNTIME_CAPABILITY,
        WORKTREE_BACKGROUND_REMOVAL_RUNTIME_CAPABILITY
      ])
    })
    expect(setConnected).not.toHaveBeenCalled()
    expect(authRejected).not.toHaveBeenCalled()
  })
})
