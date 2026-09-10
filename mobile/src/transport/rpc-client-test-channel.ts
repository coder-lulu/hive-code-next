// Deterministic framing boundary for socket lifecycle tests. Real crypto is tested separately.
import { decrypt, decryptBytes, encrypt } from './e2ee'
import type { MobileE2EEV2PhysicalChannel as PhysicalChannel } from './mobile-e2ee-v2-physical-channel'

export class MobileE2EEAuthenticationError extends Error {}

export class MobileE2EEV2PhysicalChannel {
  private ready = false
  private disposed = false
  private readonly key = new Uint8Array(32)

  constructor(private readonly args: ConstructorParameters<typeof PhysicalChannel>[0]) {}

  start(): void {
    this.args.socket.send(JSON.stringify({ type: 'e2ee_hello', v: 2 }))
  }

  async handleMessage(raw: unknown): Promise<void> {
    if (this.disposed) {
      return
    }
    if (typeof raw !== 'string') {
      if (!this.ready) {
        return
      }
      const bytes = await this.args.decodeBinary(raw)
      if (!bytes || this.disposed) {
        return
      }
      const decoded = decryptBytes(bytes, this.key)
      if (decoded) {
        this.args.onBinary(decoded)
      }
      return
    }
    if (!this.ready) {
      if (raw === JSON.stringify({ type: 'e2ee_ready' })) {
        this.args.socket.send(
          encrypt(
            JSON.stringify({ type: 'e2ee_auth', deviceToken: this.args.deviceToken }),
            this.key
          )
        )
        return
      }
      const plaintext = decrypt(raw, this.key)
      if (!plaintext) {
        return
      }
      try {
        const message = JSON.parse(plaintext)
        if (message.type === 'e2ee_authenticated') {
          this.ready = true
          this.args.onAuthenticated()
        } else if (message.type === 'e2ee_error' || message.error?.code === 'unauthorized') {
          this.args.onError(new MobileE2EEAuthenticationError())
        }
      } catch {
        /* Ignore malformed fixture messages. */
      }
      return
    }
    const plaintext = decrypt(raw, this.key)
    if (plaintext) {
      this.args.onText(plaintext)
    }
  }

  sendText(plaintext: string): boolean {
    if (this.disposed || !this.ready) {
      return false
    }
    this.args.socket.send(encrypt(plaintext, this.key))
    return true
  }

  dispose(): void {
    this.disposed = true
  }
}
