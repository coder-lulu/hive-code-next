import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import { expandTilde } from './context'
import {
  createUntitledPlaceholderRetentionHost,
  isUntitledPlaceholderOrdinaryCreateUnavailable
} from '../shared/untitled-placeholder-retention'
import { resolveUntitledPlaceholderRetentionRoot } from '../shared/untitled-placeholder-recovery-directory'
import { createRelayFile } from './fs-path-mutation-requests'

const placeholderText = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'))
const placeholderCreateParams = z
  .object({ filePath: placeholderText, ownerKey: placeholderText })
  .strict()
const placeholderDiscardParams = placeholderCreateParams
  .extend({ leaseToken: placeholderText })
  .strict()
const placeholderReleaseParams = z
  .object({ ownerKey: placeholderText, leaseToken: placeholderText })
  .strict()

export class RelayUntitledPlaceholderRequests {
  private readonly placeholderHost = createUntitledPlaceholderRetentionHost({
    resolveRetentionRoot: resolveUntitledPlaceholderRetentionRoot
  })
  private readonly placeholderIncarnation = randomUUID()
  private readonly placeholderOwners = new Map<number, Set<string>>()
  private readonly placeholderClients = new Map<
    number,
    { nonce: string; isClientStale: () => boolean }
  >()
  private readonly unsubscribeDetached: (() => void) | undefined
  private disposed = false

  constructor(private readonly dispatcher: RelayDispatcher) {
    this.unsubscribeDetached = dispatcher.onClientDetached?.((clientId) => {
      void this.releasePlaceholderClient(clientId).catch((error) => {
        console.warn('Failed to release detached placeholder owner', error)
      })
    })
    this.dispatcher.onRequest('fs.createUntitledPlaceholder', (p, c) =>
      this.createPlaceholder(p, c)
    )
    this.dispatcher.onRequest('fs.discardUntitledPlaceholder', async (p, c) => {
      const params = placeholderDiscardParams.parse(p)
      const owner = this.placeholderOwner(params.ownerKey, c)
      const result = await this.placeholderHost.discard(
        expandTilde(params.filePath),
        owner,
        params.leaseToken
      )
      this.assertPlaceholderClient(c)
      return result
    })
    this.dispatcher.onRequest('fs.releaseUntitledPlaceholder', async (p, c) => {
      const params = placeholderReleaseParams.parse(p)
      const owner = this.placeholderOwner(params.ownerKey, c)
      await this.placeholderHost.release(owner, params.leaseToken)
      this.assertPlaceholderClient(c)
    })
  }

  private assertCurrentClient(context: RequestContext): void {
    if (this.disposed || context.isStale()) {
      throw new Error('Placeholder client is unavailable')
    }
    if (!Number.isSafeInteger(context.clientId) || context.clientId < 1) {
      throw new Error('Placeholder client is unavailable')
    }
  }

  private assertPlaceholderClient(context: RequestContext): {
    principal: string
    isClientStale: () => boolean
  } {
    this.assertCurrentClient(context)
    if (
      !Number.isSafeInteger(context.clientId) ||
      context.clientId < 1 ||
      !context.sessionIdentity?.authenticated ||
      !context.sessionIdentity.principal ||
      context.sessionIdentity.authenticationKind === 'unproved'
    ) {
      throw new Error('Authenticated placeholder owner is unavailable')
    }
    if (!context.isClientStale || context.isClientStale()) {
      throw new Error('Placeholder client generation is unavailable')
    }
    return { principal: context.sessionIdentity.principal, isClientStale: context.isClientStale }
  }

  private placeholderOwner(callerOwner: string, context: RequestContext): string {
    const { principal, isClientStale } = this.assertPlaceholderClient(context)
    let client = this.placeholderClients.get(context.clientId)
    if (client?.isClientStale()) {
      void this.releasePlaceholderClient(context.clientId).catch((error) => {
        console.warn('Failed to release stale placeholder owner', error)
      })
      client = undefined
    }
    if (!client) {
      client = { nonce: randomUUID(), isClientStale }
      this.placeholderClients.set(context.clientId, client)
    }
    // Caller owner names partition one authenticated client; they never identify another client.
    const owner = JSON.stringify([
      this.placeholderIncarnation,
      context.clientId,
      client.nonce,
      principal,
      callerOwner
    ])
    return owner
  }

  private async createPlaceholder(
    params: Record<string, unknown>,
    context: RequestContext
  ): Promise<string | null> {
    const request = placeholderCreateParams.parse(params)
    this.assertCurrentClient(context)
    if (
      context.sessionIdentity?.authenticationKind === 'unproved' &&
      !context.sessionIdentity.authenticated
    ) {
      await createRelayFile({ filePath: request.filePath })
      this.assertCurrentClient(context)
      return null
    }
    const owner = this.placeholderOwner(request.ownerKey, context)
    let owners = this.placeholderOwners.get(context.clientId)
    if (!owners) {
      this.placeholderOwners.set(context.clientId, (owners = new Set()))
    }
    owners.add(owner)
    const filePath = expandTilde(request.filePath)
    let token: string
    try {
      token = await this.placeholderHost.create(filePath, owner)
    } catch (error) {
      if (!isUntitledPlaceholderOrdinaryCreateUnavailable(error)) {
        throw error
      }
      this.assertPlaceholderClient(context)
      await createRelayFile({ filePath })
      this.assertPlaceholderClient(context)
      return null
    }
    try {
      this.assertPlaceholderClient(context)
    } catch (error) {
      await this.placeholderHost.release(owner, token)
      throw error
    }
    try {
      context.onResponseSettled?.((result) => {
        if (!result.ok) {
          void this.placeholderHost.release(owner, token).catch((error) => {
            console.warn('Failed to release undelivered placeholder lease', error)
          })
        }
      })
    } catch (error) {
      await this.placeholderHost.release(owner, token)
      throw error
    }
    return token
  }

  private async releasePlaceholderClient(clientId: number): Promise<void> {
    const owners = this.placeholderOwners.get(clientId)
    this.placeholderOwners.delete(clientId)
    this.placeholderClients.delete(clientId)
    const results = await Promise.allSettled(
      [...(owners ?? [])].map((owner) => this.placeholderHost.releaseOwner(owner))
    )
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length) {
      throw new AggregateError(errors, 'Placeholder client release failed')
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.unsubscribeDetached?.()
    const results = await Promise.allSettled(
      [...this.placeholderOwners.keys()].map((clientId) => this.releasePlaceholderClient(clientId))
    )
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length) {
      throw new AggregateError(errors, 'Placeholder host disposal failed')
    }
  }
}
