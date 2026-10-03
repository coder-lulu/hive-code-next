import { randomUUID } from 'node:crypto'
import type {
  HiveRuntimeSessionPage,
  HiveRuntimeSessionRevocation
} from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeCloudClient } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudConfig } from './hive-runtime-cloud-config'

const PAGE_SIZE = 25

type SessionClient = Pick<HiveRuntimeCloudClient, 'listRuntimeSessions' | 'revokeRuntimeSession'>

type SessionDependencies = Readonly<{
  createClient: (apiBaseUrl: string) => SessionClient
  now: () => number
  operationId: () => string
}>

const defaultDependencies: SessionDependencies = {
  createClient: (apiBaseUrl) => new HiveRuntimeCloudClient(apiBaseUrl),
  now: Date.now,
  operationId: randomUUID
}

export class HiveAccountRuntimeSessionUnavailableError extends Error {
  constructor() {
    super('hive_account_runtime_sessions_signed_out')
    this.name = 'HiveAccountRuntimeSessionUnavailableError'
  }
}

export class HiveAccountRuntimeSessionService {
  private readonly client: SessionClient | null
  private readonly controllers = new Set<AbortController>()
  private authorization: HiveRuntimeCloudAuthorization | null = null
  private readonly listsInFlight = new Map<string | null, Promise<HiveRuntimeSessionPage>>()
  private stopped = false

  constructor(
    config: HiveRuntimeCloudConfig,
    private readonly dependencies: SessionDependencies = defaultDependencies
  ) {
    this.client = config.enabled ? dependencies.createClient(config.apiBaseUrl) : null
  }

  setAuthorization(authorization: HiveRuntimeCloudAuthorization | null): void {
    if (this.stopped) {
      return
    }
    this.abortOperations()
    this.authorization =
      authorization && authorization.sessionExpiresAt > this.dependencies.now()
        ? authorization
        : null
  }

  list(cursor: string | null = null): Promise<HiveRuntimeSessionPage> {
    if (cursor !== null && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(cursor))) {
      return Promise.reject(new Error('Invalid Runtime session cursor'))
    }
    const existing = this.listsInFlight.get(cursor)
    if (existing) {
      return existing
    }
    const pending = this.loadPage(cursor)
    this.listsInFlight.set(cursor, pending)
    void pending.then(
      () => this.finishList(cursor, pending),
      () => this.finishList(cursor, pending)
    )
    return pending
  }

  private async loadPage(cursor: string | null): Promise<HiveRuntimeSessionPage> {
    const { authorization, client, controller } = this.startOperation()
    try {
      const page = await client.listRuntimeSessions(
        authorization.accessToken,
        cursor,
        PAGE_SIZE,
        controller.signal
      )
      this.assertCurrent(authorization)
      if (
        page.items.length > PAGE_SIZE ||
        new Set(page.items.map((item) => item.managedSessionId)).size !== page.items.length
      ) {
        throw new Error('hive_account_runtime_session_invalid_page')
      }
      if (page.nextCursor !== null && page.nextCursor === cursor) {
        throw new Error('hive_account_runtime_session_cursor_loop')
      }
      return page
    } finally {
      this.finishOperation(controller)
    }
  }

  async revoke(
    managedSessionId: string,
    expectedResourceVersion: number
  ): Promise<HiveRuntimeSessionRevocation> {
    const { authorization, client, controller } = this.startOperation()
    try {
      const session = await client.revokeRuntimeSession(
        managedSessionId,
        expectedResourceVersion,
        authorization.accessToken,
        this.dependencies.operationId(),
        controller.signal
      )
      this.assertCurrent(authorization)
      if (session.managedSessionId !== managedSessionId) {
        throw new Error('hive_account_runtime_session_mismatch')
      }
      return session
    } finally {
      this.finishOperation(controller)
    }
  }

  stop(): void {
    this.stopped = true
    this.authorization = null
    this.abortOperations()
  }

  private startOperation(): Readonly<{
    authorization: HiveRuntimeCloudAuthorization
    client: SessionClient
    controller: AbortController
  }> {
    const authorization = this.authorization
    if (
      this.stopped ||
      !this.client ||
      !authorization ||
      authorization.sessionExpiresAt <= this.dependencies.now()
    ) {
      throw new HiveAccountRuntimeSessionUnavailableError()
    }
    const controller = new AbortController()
    this.controllers.add(controller)
    return { authorization, client: this.client, controller }
  }

  private assertCurrent(authorization: HiveRuntimeCloudAuthorization): void {
    const current = this.authorization
    if (
      this.stopped ||
      current?.accountId !== authorization.accountId ||
      current.authorityId !== authorization.authorityId ||
      current.sessionGeneration !== authorization.sessionGeneration ||
      current.sessionExpiresAt <= this.dependencies.now()
    ) {
      throw new HiveAccountRuntimeSessionUnavailableError()
    }
  }

  private finishOperation(controller: AbortController): void {
    this.controllers.delete(controller)
  }

  private finishList(cursor: string | null, pending: Promise<HiveRuntimeSessionPage>): void {
    if (this.listsInFlight.get(cursor) === pending) {
      this.listsInFlight.delete(cursor)
    }
  }

  private abortOperations(): void {
    this.listsInFlight.clear()
    for (const controller of this.controllers) {
      controller.abort()
    }
    this.controllers.clear()
  }
}
