import { describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import {
  HiveAccountRuntimeSessionService,
  HiveAccountRuntimeSessionUnavailableError
} from './hive-account-runtime-session-service'

const config = {
  enabled: true,
  apiBaseUrl: 'https://api.hivekernel.com'
} as const

const authorization: HiveRuntimeCloudAuthorization = {
  authorityId: 'hive-primary',
  accountId: '11111111-1111-4111-8111-111111111111',
  accessToken: 'account-secret',
  sessionGeneration: 2,
  sessionExpiresAt: 2_000
}

const session = {
  managedSessionId: '22222222-2222-4222-8222-222222222222',
  runtimeRecordId: '33333333-3333-4333-8333-333333333333',
  runtimeInstanceId: '44444444-4444-4444-8444-444444444444',
  runtimeSessionId: '55555555-5555-4555-8555-555555555555',
  clientKind: 'DESKTOP' as const,
  clientLabel: 'Laptop',
  status: 'ACTIVE' as const,
  resourceVersion: 1,
  controlVersion: 1,
  createdAt: 1,
  expiresAt: 2,
  revokeRequestedAt: null,
  revokeAcknowledgedAt: null
}

function createService() {
  const client = {
    listRuntimeSessions: vi
      .fn()
      .mockResolvedValueOnce({ items: [session], nextCursor: 'second' })
      .mockResolvedValueOnce({ items: [], nextCursor: null }),
    revokeRuntimeSession: vi
      .fn()
      .mockResolvedValue({ ...session, status: 'REVOKE_PENDING', controlVersion: 2 })
  }
  const service = new HiveAccountRuntimeSessionService(config as never, {
    createClient: () => client,
    now: () => 1_000,
    operationId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  })
  return { client, service }
}

describe('Hive account Runtime session service', () => {
  it('loads every page and revokes with the current account authorization', async () => {
    const { client, service } = createService()
    service.setAuthorization(authorization)

    await expect(service.list()).resolves.toEqual([session])
    await expect(service.revoke(session.managedSessionId, 1)).resolves.toMatchObject({
      status: 'REVOKE_PENDING'
    })
    expect(client.listRuntimeSessions.mock.calls.map((call) => call[1])).toEqual([null, 'second'])
    expect(client.revokeRuntimeSession).toHaveBeenCalledWith(
      session.managedSessionId,
      1,
      'account-secret',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expect.any(AbortSignal)
    )
  })

  it('shares one 100-page traversal across concurrent list callers', async () => {
    let resolveFirstPage!: (value: { items: (typeof session)[]; nextCursor: string }) => void
    const firstPage = new Promise<{
      items: (typeof session)[]
      nextCursor: string
    }>((resolve) => {
      resolveFirstPage = resolve
    })
    const listRuntimeSessions = vi.fn(
      (_token: string, cursor: string | null, _limit: number, _signal?: AbortSignal) => {
        if (cursor === null) {
          return firstPage
        }
        const page = Number(cursor)
        return Promise.resolve({
          items: [],
          nextCursor: page < 99 ? String(page + 1) : null
        })
      }
    )
    const service = new HiveAccountRuntimeSessionService(config as never, {
      createClient: () => ({ listRuntimeSessions, revokeRuntimeSession: vi.fn() }),
      now: () => 1_000,
      operationId: vi.fn()
    })
    service.setAuthorization(authorization)

    const first = service.list()
    const second = service.list()
    expect(second).toBe(first)
    expect(listRuntimeSessions).toHaveBeenCalledOnce()
    resolveFirstPage({ items: [session], nextCursor: '1' })

    await expect(Promise.all([first, second])).resolves.toEqual([[session], [session]])
    expect(listRuntimeSessions).toHaveBeenCalledTimes(100)
    expect(listRuntimeSessions.mock.calls.every((call) => call[2] === 100)).toBe(true)
    expect(new Set(listRuntimeSessions.mock.calls.map((call) => call[3])).size).toBe(1)

    listRuntimeSessions.mockResolvedValueOnce({ items: [], nextCursor: null })
    await expect(service.list()).resolves.toEqual([])
    expect(listRuntimeSessions).toHaveBeenCalledTimes(101)
    service.stop()
  })

  it('rejects a session directory that continues beyond 100 empty pages', async () => {
    let page = 0
    const listRuntimeSessions = vi.fn().mockImplementation(async () => ({
      items: [],
      nextCursor: `page-${++page}`
    }))
    const service = new HiveAccountRuntimeSessionService(config as never, {
      createClient: () => ({ listRuntimeSessions, revokeRuntimeSession: vi.fn() }),
      now: () => 1_000,
      operationId: vi.fn()
    })
    service.setAuthorization(authorization)

    await expect(service.list()).rejects.toThrow('hive_account_runtime_session_page_limit')
    expect(listRuntimeSessions).toHaveBeenCalledTimes(100)
    service.stop()
  })

  it('does not let an aborted account traversal clear the replacement singleflight', async () => {
    let resolveOld!: (value: { items: never[]; nextCursor: null }) => void
    let resolveCurrent!: (value: { items: (typeof session)[]; nextCursor: null }) => void
    const listRuntimeSessions = vi.fn((token: string) => {
      if (token === authorization.accessToken) {
        return new Promise<{ items: never[]; nextCursor: null }>((resolve) => {
          resolveOld = resolve
        })
      }
      return new Promise<{ items: (typeof session)[]; nextCursor: null }>((resolve) => {
        resolveCurrent = resolve
      })
    })
    const service = new HiveAccountRuntimeSessionService(config as never, {
      createClient: () => ({ listRuntimeSessions, revokeRuntimeSession: vi.fn() }),
      now: () => 1_000,
      operationId: vi.fn()
    })
    service.setAuthorization(authorization)
    const stale = service.list()
    const staleFailure = expect(stale).rejects.toBeInstanceOf(
      HiveAccountRuntimeSessionUnavailableError
    )

    service.setAuthorization({
      ...authorization,
      accessToken: 'replacement-secret',
      sessionGeneration: authorization.sessionGeneration + 1
    })
    const current = service.list()
    expect(current).not.toBe(stale)
    resolveOld({ items: [], nextCursor: null })
    await staleFailure

    expect(service.list()).toBe(current)
    resolveCurrent({ items: [session], nextCursor: null })
    await expect(current).resolves.toEqual([session])
    expect(listRuntimeSessions).toHaveBeenCalledTimes(2)
    service.stop()
  })

  it('fences an in-flight list after switching authority with the same account generation', async () => {
    let resolveOld!: (value: { items: never[]; nextCursor: null }) => void
    let resolveCurrent!: (value: { items: (typeof session)[]; nextCursor: null }) => void
    let requestCount = 0
    const listRuntimeSessions = vi.fn(
      () =>
        new Promise<{ items: (typeof session)[]; nextCursor: null }>((resolve) => {
          requestCount += 1
          if (requestCount === 1) {
            resolveOld = resolve
          } else {
            resolveCurrent = resolve
          }
        })
    )
    const service = new HiveAccountRuntimeSessionService(config as never, {
      createClient: () => ({ listRuntimeSessions, revokeRuntimeSession: vi.fn() }),
      now: () => 1_000,
      operationId: vi.fn()
    })
    service.setAuthorization(authorization)
    const stale = service.list()
    const staleFailure = expect(stale).rejects.toBeInstanceOf(
      HiveAccountRuntimeSessionUnavailableError
    )

    service.setAuthorization({ ...authorization, authorityId: 'hive-secondary' })
    const current = service.list()
    resolveOld({ items: [], nextCursor: null })
    await staleFailure

    resolveCurrent({ items: [session], nextCursor: null })
    await expect(current).resolves.toEqual([session])
    expect(listRuntimeSessions).toHaveBeenCalledTimes(2)
    service.stop()
  })

  it('fences an in-flight result after account sign-out', async () => {
    let resolvePage!: (value: { items: never[]; nextCursor: null }) => void
    const client = {
      listRuntimeSessions: vi.fn(
        () =>
          new Promise<{ items: never[]; nextCursor: null }>((resolve) => (resolvePage = resolve))
      ),
      revokeRuntimeSession: vi.fn()
    }
    const service = new HiveAccountRuntimeSessionService(config as never, {
      createClient: () => client,
      now: () => 1_000,
      operationId: vi.fn()
    })
    service.setAuthorization(authorization)
    const pending = service.list()
    service.setAuthorization(null)
    resolvePage({ items: [], nextCursor: null })

    await expect(pending).rejects.toBeInstanceOf(HiveAccountRuntimeSessionUnavailableError)
    await expect(service.list()).rejects.toBeInstanceOf(HiveAccountRuntimeSessionUnavailableError)
  })

  it('does not retain authorization delivered after the service stops', async () => {
    const { service } = createService()
    service.stop()

    service.setAuthorization(authorization)

    expect(
      (service as unknown as { authorization: HiveRuntimeCloudAuthorization | null }).authorization
    ).toBeNull()
    await expect(service.list()).rejects.toBeInstanceOf(HiveAccountRuntimeSessionUnavailableError)
  })
})
