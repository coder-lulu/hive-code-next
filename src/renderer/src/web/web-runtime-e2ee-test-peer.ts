import nacl from 'tweetnacl'
import { RuntimeE2EEClientSession } from '../../../shared/runtime-e2ee-client-session'
import { DesktopMobileE2EEV2Session } from '../../../shared/runtime-e2ee-server-session'

export type WebRuntimeTestSession = ReturnType<typeof createWebRuntimeTestSession>

export function createWebRuntimeTestSession(acceptReady = true) {
  const keys = nacl.box.keyPair()
  const client = RuntimeE2EEClientSession.create({
    desktopPublicKeyB64: Buffer.from(keys.publicKey).toString('base64'),
    transport: 'direct'
  })
  const server = DesktopMobileE2EEV2Session.create({
    hello: client.hello,
    serverSecretKey: keys.secretKey,
    expectedContext: { transport: 'direct' }
  })!
  if (acceptReady && !client.acceptReady(server.ready)) {
    throw new Error('Test handshake failed')
  }
  return { client, server }
}

export function encrypt(text: string, session: WebRuntimeTestSession): string {
  return session.server.sealText(text)
}
export function decrypt(text: string, session: WebRuntimeTestSession): string | null {
  return session.server.openText(text)
}
export function encryptBytes(bytes: Uint8Array, session: WebRuntimeTestSession): Uint8Array {
  return session.server.sealBinary(bytes)
}
