import { relayBase64Url, type HiveAccountRelayMaterial } from './hive-account-relay-material'
import { RuntimeE2EEClientSession } from './runtime-e2ee-client-session'
import { parseHiveRelayJson } from './hive-relay-json'
import { validateRelayHello } from './hive-account-relay-channel-protocol'
import type { RuntimeCapability } from './protocol-version'

export class HiveAccountRelayHandshake {
  readonly session: RuntimeE2EEClientSession
  private state: 'outer' | 'ready' | 'auth' | 'connected' = 'outer'

  constructor(
    private readonly material: HiveAccountRelayMaterial,
    private readonly clientCapabilities: readonly RuntimeCapability[] = [],
    randomBytes?: (length: number) => Uint8Array
  ) {
    this.session = RuntimeE2EEClientSession.create({
      desktopPublicKeyB64: material.inner.runtimePublicKeyB64,
      transport: 'relay',
      relayHostId: material.outer.relayHostId,
      clientKeyPair: material.clientKeyPair,
      randomBytes
    })
  }

  accept(raw: unknown, send: (data: string) => void): boolean {
    if (typeof raw !== 'string') {
      throw new Error('Invalid handshake frame')
    }
    if (this.state === 'outer') {
      if (!validateRelayHello(raw, this.material.outer)) {
        throw new Error('Invalid relay binding')
      }
      this.state = 'ready'
      send(JSON.stringify(this.session.hello))
      this.material.outer.clientAdmissionToken = ''
    } else if (this.state === 'ready') {
      if (!this.session.acceptReady(parseHiveRelayJson(raw))) {
        throw new Error('Invalid runtime identity')
      }
      this.state = 'auth'
      send(
        this.session.sealText(
          JSON.stringify({
            type: 'e2ee_auth',
            principalKind: 'account_runtime_session',
            ticketId: this.material.inner.ticketId,
            ticketSecret: relayBase64Url(this.material.inner.ticketSecret),
            clientCapabilities: this.clientCapabilities
          })
        )
      )
      this.material.inner.ticketSecret.fill(0)
      this.material.clientKeyPair.secretKey.fill(0)
    } else if (this.state === 'auth') {
      const plaintext = this.session.openText(raw)
      if (plaintext !== null) {
        parseHiveRelayJson(plaintext)
      }
      if (plaintext === null || !this.session.isAuthenticated(plaintext)) {
        throw new Error('Account runtime authorization failed')
      }
      this.state = 'connected'
      return true
    } else {
      throw new Error('Account handshake already completed')
    }
    return false
  }
}
