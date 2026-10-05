import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CloudManagedE2EEAuth } from '../runtime/rpc/cloud-managed-e2ee-auth-validation'
import type { E2EEAuthenticatedCloudSession } from '../runtime/rpc/e2ee-channel'
import type { WebSocketConnectionRequest } from '../runtime/rpc/ws-transport'
import { HiveRuntimeCloudClient, HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudWebLaunchConfig } from './hive-runtime-cloud-config'
import {
  HiveRuntimeCloudManagedSessionRegistry,
  type HiveRuntimeCloudControlledRevocationResult,
  type HiveRuntimeCloudManagedWebSessionPrincipal
} from './hive-runtime-cloud-managed-session-registry'
import type { HiveRuntimeCloudPresenceService } from './hive-runtime-cloud-presence-service'
import { createRuntimeConnectionTicketConsumeRequest } from './hive-runtime-cloud-proof'
import { readManagedRuntimeDisplayMetadata } from './hive-runtime-cloud-display-metadata-service'
import { hiveRuntimeCloudTuplesEqual as sameTuple } from './hive-runtime-cloud-lease-context'

const EXCHANGE_PATH = '/_hive/web-launch/exchange'
const MAXIMUM_REQUEST_BYTES = 4096
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SECRET_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

type TicketClient = Pick<
  HiveRuntimeCloudClient,
  'consumeConnectionTicket' | 'readWebSessionDisplayMetadata'
>
type PresenceSource = Pick<
  HiveRuntimeCloudPresenceService,
  'getCurrentLeaseContext' | 'subscribeLeaseContext'
>

export type HiveRuntimeCloudWebLaunchServiceOptions = Readonly<{
  apiBaseUrl: string
  config: HiveRuntimeCloudWebLaunchConfig
  presence: PresenceSource
  getServerPublicKey: () => string | null
  terminateSessionConnections: (managedWebSessionId: string) => void
  client?: TicketClient
  now?: () => number
}>

export class HiveRuntimeCloudWebLaunchService {
  private readonly config: HiveRuntimeCloudWebLaunchConfig
  private readonly presence: PresenceSource
  private readonly getServerPublicKey: () => string | null
  private readonly client: TicketClient
  private readonly now: () => number
  private readonly terminateSessionConnections: (managedWebSessionId: string) => void
  private readonly registry: HiveRuntimeCloudManagedSessionRegistry
  private readonly unsubscribePresence: () => void

  constructor(options: HiveRuntimeCloudWebLaunchServiceOptions) {
    this.config = options.config
    this.presence = options.presence
    this.getServerPublicKey = options.getServerPublicKey
    this.client = options.client ?? new HiveRuntimeCloudClient(options.apiBaseUrl)
    this.now = options.now ?? Date.now
    this.terminateSessionConnections = options.terminateSessionConnections
    this.registry = new HiveRuntimeCloudManagedSessionRegistry({
      onInvalidate: ({ principal }) => {
        this.terminateSessionConnections(principal.managedWebSessionId)
      }
    })
    this.unsubscribePresence = this.presence.subscribeLeaseContext((context) => {
      if (context) {
        this.registry.fenceTuple(context.tuple)
      } else {
        this.registry.clear()
      }
    })
  }

  async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (!request.url || !request.url.startsWith(EXCHANGE_PATH)) {
      return false
    }
    this.applySecurityHeaders(response)
    if (request.url !== EXCHANGE_PATH) {
      this.writeProblem(response, 400, 'invalid_cloud_launch_request')
      return true
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      this.writeProblem(response, 405, 'invalid_cloud_launch_method')
      return true
    }
    if (!this.hasSafeHeaders(request)) {
      this.writeProblem(response, 403, 'cloud_launch_request_rejected')
      return true
    }
    let credential: { ticketId: string; launchSecret: string }
    try {
      credential = this.parseCredential(await readRequestBody(request))
    } catch (error) {
      const status = error === REQUEST_TOO_LARGE ? 413 : 400
      this.writeProblem(response, status, 'invalid_cloud_launch_request')
      return true
    }
    const context = this.presence.getCurrentLeaseContext()
    const serverPublicKeyB64 = this.getServerPublicKey()
    if (!context || !serverPublicKeyB64) {
      this.writeProblem(response, 503, 'cloud_launch_unavailable')
      return true
    }
    try {
      const consumed = await this.client.consumeConnectionTicket(
        createRuntimeConnectionTicketConsumeRequest(
          context.identity,
          { ...credential, ...context.tuple },
          { authorityId: context.authorityId }
        )
      )
      if (consumed.expiresAt <= this.now()) {
        this.writeProblem(response, 410, 'cloud_launch_unavailable')
        return true
      }
      const current = this.presence.getCurrentLeaseContext()
      if (
        !current ||
        !sameTuple(context.tuple, current.tuple) ||
        consumed.runtimeDisplayMetadata.runtimeRecordId !== current.tuple.runtimeRecordId
      ) {
        this.writeProblem(response, 503, 'cloud_launch_unavailable')
        return true
      }
      const bootstrap = this.registry.register({
        managedWebSessionId: consumed.managedWebSessionId,
        runtimeSessionId: consumed.runtimeSessionId,
        currentTuple: current.tuple,
        expiresAt: consumed.expiresAt,
        controlVersion: consumed.controlVersion,
        ownershipEpoch: consumed.runtimeDisplayMetadata.ownershipEpoch
      })
      response.statusCode = 201
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(
        JSON.stringify({
          protocolVersion: 'cloud-launch/v1',
          managedWebSessionId: consumed.managedWebSessionId,
          runtimeSessionId: consumed.runtimeSessionId,
          websocketUrl: websocketUrl(this.config),
          serverPublicKeyB64,
          sessionToken: bootstrap.sessionToken,
          expiresAt: new Date(consumed.expiresAt).toISOString(),
          runtimeDisplayMetadata: consumed.runtimeDisplayMetadata
        })
      )
    } catch (error) {
      const status =
        error instanceof HiveRuntimeCloudRequestError && error.status === 410 ? 410 : 503
      this.writeProblem(response, status, 'cloud_launch_unavailable')
    }
    return true
  }

  resolveSession(
    auth: CloudManagedE2EEAuth,
    connection: WebSocketConnectionRequest
  ): HiveRuntimeCloudManagedWebSessionPrincipal | null {
    if (
      connection.pathname !== this.config.websocketPath ||
      connection.origin !== this.config.publicOrigin
    ) {
      return null
    }
    const context = this.presence.getCurrentLeaseContext()
    return context
      ? this.registry.resolve({
          managedWebSessionId: auth.managedWebSessionId,
          runtimeSessionId: auth.runtimeSessionId,
          sessionToken: auth.sessionToken,
          currentTuple: context.tuple,
          now: this.now()
        })
      : null
  }

  revalidateSession(principal: E2EEAuthenticatedCloudSession): boolean {
    const context = this.presence.getCurrentLeaseContext()
    return context ? this.registry.revalidate(principal, context.tuple, this.now()) : false
  }

  readDisplayMetadata(principal: E2EEAuthenticatedCloudSession, signal?: AbortSignal) {
    return readManagedRuntimeDisplayMetadata({
      principal,
      registry: this.registry,
      getContext: () => this.presence.getCurrentLeaseContext(),
      client: this.client,
      now: this.now,
      signal
    })
  }

  revokeManagedSession(
    command: Readonly<{
      managedWebSessionId: string
      runtimeSessionId: string
      controlVersion: number
    }>
  ): HiveRuntimeCloudControlledRevocationResult {
    const result = this.registry.revokeControlled(command)
    if (result === 'ABSENT') {
      this.terminateSessionConnections(command.managedWebSessionId)
    }
    return result
  }

  expireManagedSessions(): number {
    return this.registry.pruneExpired(this.now())
  }

  close(): void {
    this.unsubscribePresence()
    this.registry.clear()
  }

  private hasSafeHeaders(request: IncomingMessage): boolean {
    return (
      singleHeader(request, 'origin') === this.config.publicOrigin &&
      singleHeader(request, 'content-type') === 'application/json' &&
      headerValues(request, 'authorization').length === 0 &&
      headerValues(request, 'proxy-authorization').length === 0 &&
      headerValues(request, 'cookie').length === 0
    )
  }

  private parseCredential(body: Buffer): { ticketId: string; launchSecret: string } {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown
    if (
      !isRecord(value) ||
      Object.keys(value).sort().join(',') !== 'launchSecret,protocolVersion,ticketId'
    ) {
      throw new Error('invalid_cloud_launch_request')
    }
    if (
      value.protocolVersion !== 'cloud-launch/v1' ||
      typeof value.ticketId !== 'string' ||
      !UUID_PATTERN.test(value.ticketId) ||
      typeof value.launchSecret !== 'string' ||
      !SECRET_PATTERN.test(value.launchSecret)
    ) {
      throw new Error('invalid_cloud_launch_request')
    }
    return { ticketId: value.ticketId, launchSecret: value.launchSecret }
  }

  private applySecurityHeaders(response: ServerResponse): void {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Pragma', 'no-cache')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
  }

  private writeProblem(response: ServerResponse, status: number, code: string): void {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ code }))
  }
}

const REQUEST_TOO_LARGE = Symbol('request_too_large')

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    length += chunk.length
    if (length > MAXIMUM_REQUEST_BYTES) {
      throw REQUEST_TOO_LARGE
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, length)
}

function singleHeader(request: IncomingMessage, name: string): string | null {
  const matches = headerValues(request, name)
  return matches.length === 1 ? matches[0]! : null
}

function headerValues(request: IncomingMessage, name: string): string[] {
  const matches: string[] = []
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      matches.push(request.rawHeaders[index + 1] ?? '')
    }
  }
  return matches
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function websocketUrl(config: HiveRuntimeCloudWebLaunchConfig): string {
  return `wss://${new URL(config.publicOrigin).host}${config.websocketPath}`
}
