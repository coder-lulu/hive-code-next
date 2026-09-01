import { randomUUID } from 'node:crypto'
import type { HiveRuntimeSession } from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeCloudClient } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudConfig } from './hive-runtime-cloud-config'

const PAGE_SIZE = 100
const MAXIMUM_SESSIONS = 10_000
const MAXIMUM_SESSION_PAGES = Math.ceil(MAXIMUM_SESSIONS / PAGE_SIZE)

type SessionClient = Pick<HiveRuntimeCloudClient, 'listRuntimeSessions' | 'revokeRuntimeSession'>

type SessionDependencies = Readonly<{
  createClient: (apiBaseUrl: string) => SessionClient
  now: () => number
  idempotencyKey: () => string
}>

const defaultDependencies: SessionDependencies = {
  createClient: (apiBaseUrl) => new HiveRuntimeCloudClient(apiBaseUrl),
  now: Date.now,
  idempotencyKey: randomUUID
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
  private listInFlight: Promise<readonly HiveRuntimeSession[]> | null = null
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

  list(): Promise<readonly HiveRuntimeSession[]> {
    if (this.listInFlight) {
      return this.listInFlight
    }
    const pending = this.loadSessions()
    this.listInFlight = pending
    void pending.then(
      () => this.finishList(pending),
      () => this.finishList(pending)
    )
    return pending
  }

  private async loadSessions(): Promise<readonly HiveRuntimeSession[]> {
    const { authorization, client, controller } = this.startOperation()
    try {
      const items: HiveRuntimeSession[] = []
      const ids = new Set<string>()
      const cursors = new Set<string>()
      let cursor: string | null = null
      let pageCount = 0
      do {
        pageCount += 1
        if (pageCount > MAXIMUM_SESSION_PAGES) {
          throw new Error('hive_account_runtime_session_page_limit')
        }
        const page = await client.listRuntimeSessions(
          authorization.accessToken,
          cursor,
          PAGE_SIZE,
          controller.signal
        )
        this.assertCurrent(authorization)
        for (const session of page.items) {
          if (ids.has(session.managedWebSessionId)) {
            throw new Error('hive_account_runtime_session_duplicate')
          }
          ids.add(session.managedWebSessionId)
          items.push(session)
          if (items.length > MAXIMUM_SESSIONS) {
            throw new Error('hive_account_runtime_session_directory_too_large')
          }
        }
        cursor = page.nextCursor
        if (cursor !== null && cursors.has(cursor)) {
          throw new Error('hive_account_runtime_session_cursor_loop')
        }
        if (cursor !== null) {
          cursors.add(cursor)
        }
      } while (cursor !== null)
      return items
    } finally {
      this.finishOperation(controller)
    }
  }

  async revoke(
    managedWebSessionId: string,
    expectedControlVersion: number
  ): Promise<HiveRuntimeSession> {
    const { authorization, client, controller } = this.startOperation()
    try {
      const session = await client.revokeRuntimeSession(
        managedWebSessionId,
        expectedControlVersion,
        authorization.accessToken,
        this.dependencies.idempotencyKey(),
        controller.signal
      )
      this.assertCurrent(authorization)
      if (session.managedWebSessionId !== managedWebSessionId) {
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

  private finishList(pending: Promise<readonly HiveRuntimeSession[]>): void {
    if (this.listInFlight === pending) {
      this.listInFlight = null
    }
  }

  private abortOperations(): void {
    this.listInFlight = null
    for (const controller of this.controllers) {
      controller.abort()
    }
    this.controllers.clear()
  }
}
