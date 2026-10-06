import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'
import type { UntitledPlaceholderDiscardResult } from '../../shared/untitled-placeholder-retention-types'
import {
  untitledPlaceholderDiscardResultSchema,
  untitledPlaceholderLeaseTokenSchema
} from '../../shared/untitled-placeholder-wire-contract'
export class SshPlaceholderTransport {
  protected disposed = false
  private readonly placeholderLeases = new Map<string, string>()

  constructor(private readonly placeholderMux: SshChannelMultiplexer) {
    this.createUntitledPlaceholder = this.createUntitledPlaceholder.bind(this)
    this.discardUntitledPlaceholder = this.discardUntitledPlaceholder.bind(this)
    this.releaseUntitledPlaceholder = this.releaseUntitledPlaceholder.bind(this)
  }

  private assertPlaceholderAvailable(): void {
    if (this.disposed || this.placeholderMux.isDisposed()) {
      throw new Error('SSH filesystem provider disposed')
    }
  }

  async createUntitledPlaceholder(filePath: string, ownerKey: string): Promise<string | null> {
    this.assertPlaceholderAvailable()
    let result: unknown
    try {
      result = await this.placeholderMux.request('fs.createUntitledPlaceholder', {
        filePath,
        ownerKey
      })
    } catch (error) {
      this.assertPlaceholderAvailable()
      if (!isMethodNotFoundError(error)) {
        throw error
      }
      await this.placeholderMux.request('fs.createFile', { filePath })
      this.assertPlaceholderAvailable()
      return null
    }
    if (this.disposed || this.placeholderMux.isDisposed()) {
      if (typeof result === 'string' && !this.placeholderMux.isDisposed()) {
        await this.placeholderMux.request('fs.releaseUntitledPlaceholder', {
          ownerKey,
          leaseToken: result
        })
      }
      throw new Error('SSH filesystem provider disposed')
    }
    const token = untitledPlaceholderLeaseTokenSchema.parse(result)
    if (token === null) {
      return null
    }
    this.placeholderLeases.set(token, ownerKey)
    return token
  }

  async discardUntitledPlaceholder(
    filePath: string,
    ownerKey: string,
    leaseToken: string
  ): Promise<UntitledPlaceholderDiscardResult> {
    this.assertPlaceholderAvailable()
    const result = await this.placeholderMux.request('fs.discardUntitledPlaceholder', {
      filePath,
      ownerKey,
      leaseToken
    })
    this.assertPlaceholderAvailable()
    const parsed = untitledPlaceholderDiscardResultSchema.parse(result)
    if (
      parsed.status === 'removed-placeholder' ||
      parsed.status === 'recovery-required' ||
      (parsed.status === 'preserved' && parsed.recovery)
    ) {
      this.placeholderLeases.delete(leaseToken)
    }
    return parsed
  }

  async releaseUntitledPlaceholder(ownerKey: string, leaseToken: string): Promise<void> {
    this.assertPlaceholderAvailable()
    await this.placeholderMux.request('fs.releaseUntitledPlaceholder', { ownerKey, leaseToken })
    this.assertPlaceholderAvailable()
    if (this.placeholderLeases.get(leaseToken) === ownerKey) {
      this.placeholderLeases.delete(leaseToken)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const [leaseToken, ownerKey] of this.placeholderLeases) {
      void this.placeholderMux
        .request('fs.releaseUntitledPlaceholder', { ownerKey, leaseToken })
        .catch((error) => {
          console.warn('Failed to release remote untitled placeholder lease', error)
        })
    }
    this.placeholderLeases.clear()
  }
}
