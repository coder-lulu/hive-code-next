// @vitest-environment jsdom
import nacl from 'tweetnacl'
import { expect, it, vi } from 'vitest'
import { createPairedE2EEClientHandshake } from '../../../shared/paired-e2ee-client-handshake'
import { DesktopMobileE2EEV2Session } from '../../../shared/runtime-e2ee-server-session'
import { WEB_PAIRED_E2EE_PRIMITIVES } from './web-paired-e2ee-primitives'
import { WebRuntimeConnectionAuth } from './web-runtime-connection-auth'
import { webRuntimeTransportConnection } from './web-runtime-transport-connection'
import type { CloudLaunchBootstrap } from './cloud-launch-bootstrap'
import type { WebRuntimeAuthPlan } from './web-runtime-credential-source'

it('binds cloud principal to the current v2 transcript without a paired-device bearer', async () => {
  const keys = nacl.box.keyPair()
  const bootstrap: CloudLaunchBootstrap = {
    protocolVersion: 'cloud-launch/v1',
    managedWebSessionId: 'managed',
    runtimeSessionId: 'runtime',
    websocketUrl: 'wss://runtime.example/rpc',
    serverPublicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
    sessionToken: 'test-cloud-session-token',
    expiresAt: '2099-01-01T00:00:00Z',
    runtimeDisplayMetadata: {
      runtimeRecordId: 'runtime',
      resourceVersion: 1,
      ownershipEpoch: 1,
      cloudDisplayName: null,
      cloudDisplayNameVersion: 1,
      deviceName: null
    }
  }
  const connection = webRuntimeTransportConnection(bootstrap)
  const auth = new WebRuntimeConnectionAuth(connection, {
    retryLater: vi.fn(),
    allowKeyMigration: true
  })
  let plan!: WebRuntimeAuthPlan
  auth.open((value) => {
    plan = value
  })
  expect(auth.framingFor(plan)).toBe('v2')
  const handshake = createPairedE2EEClientHandshake({
    primitives: WEB_PAIRED_E2EE_PRIMITIVES,
    hostPublicKeyB64: connection.hostPublicKeyB64,
    framing: auth.framingFor(plan),
    transport: 'direct'
  })
  const server = DesktopMobileE2EEV2Session.create({
    hello: JSON.parse(handshake.helloText()),
    serverSecretKey: keys.secretKey,
    expectedContext: { transport: 'direct' }
  })!
  expect(handshake.acceptReadyText(JSON.stringify(server.ready))).toBe('accepted')
  const send = vi.fn(),
    fail = vi.fn()
  await auth.sendAuth({
    handshake,
    fallbackToken: 'must-not-leak',
    isCurrent: () => true,
    send,
    fail
  })
  const frame = JSON.parse(server.openText(send.mock.calls[0][0])!)
  expect(frame).toMatchObject({
    principalKind: 'cloud_managed_web_session',
    managedWebSessionId: 'managed',
    runtimeSessionId: 'runtime',
    sessionToken: bootstrap.sessionToken,
    transcriptHashB64: handshake.transcriptHashB64()
  })
  expect(frame).not.toHaveProperty('deviceToken')
  expect(auth.outbound({ method: 'status.get', deviceToken: 'must-not-leak' })).toEqual({
    method: 'status.get'
  })
  send.mockClear()
  await auth.sendAuth({ handshake, fallbackToken: '', isCurrent: () => false, send, fail })
  expect(send).not.toHaveBeenCalled()
  expect(fail).not.toHaveBeenCalled()
})
