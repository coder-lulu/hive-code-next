import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(1),
  randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
}))
vi.mock('expo-secure-store', () => ({}))

import { loadAllAccountRuntimes } from './account-runtime-directory-client'
import { updateAccountRuntimeDisplayName } from './account-runtime-display-name-client'
import {
  AccountRuntimeDirectoryEntrySchema,
  type AccountRuntimeDirectoryEntry
} from './account-runtime-directory-types'
import type { MobileSession } from '../auth/mobile-sms-auth'

const session = { accessToken: 'token' } as MobileSession
const runtime = (runtimeRecordId: string, resourceVersion: number) =>
  ({
    runtimeRecordId,
    status: 'CLAIMED',
    runtimeVersion: '1.0.0',
    runtimeProtocolVersion: 3,
    capabilities: [],
    resourceVersion,
    createdAt: '2026-08-31T00:00:00Z',
    claimedAt: '2026-08-31T00:00:00Z',
    updatedAt: '2026-08-31T00:00:00Z',
    lastHeartbeatAt: null,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    freeDiskBytes: null,
    connectionCapabilities: []
  }) satisfies AccountRuntimeDirectoryEntry

describe('account Runtime directory client', () => {
  it('accepts 128 Unicode code points but rejects non-normalized aliases', () => {
    const value = runtime('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1)

    expect(
      AccountRuntimeDirectoryEntrySchema.parse({
        ...value,
        cloudDisplayName: '🐝'.repeat(128),
        cloudDisplayNameVersion: 1
      }).cloudDisplayName
    ).toBe('🐝'.repeat(128))
    expect(() =>
      AccountRuntimeDirectoryEntrySchema.parse({ ...value, cloudDisplayName: 'Cafe\u0301' })
    ).toThrow()
    expect(() =>
      AccountRuntimeDirectoryEntrySchema.parse({ ...value, cloudDisplayName: 'Alias' })
    ).toThrow()
    expect(
      AccountRuntimeDirectoryEntrySchema.parse({
        ...value,
        cloudDisplayName: undefined,
        cloudDisplayNameVersion: 2
      }).cloudDisplayNameVersion
    ).toBe(2)
  })

  it('sends the frozen alias PATCH body without an idempotency header', async () => {
    const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          runtimeRecordId,
          cloudDisplayName: 'Mobile Runtime',
          cloudDisplayNameVersion: 2,
          ownershipEpoch: 1,
          updatedAt: '2026-09-01T00:00:00Z'
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchImpl)

    await expect(
      updateAccountRuntimeDisplayName(session, runtimeRecordId, ' Mobile Runtime ', 1)
    ).resolves.toMatchObject({ cloudDisplayNameVersion: 2 })
    const [, init] = fetchImpl.mock.calls[0]!
    expect(init).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({
        cloudDisplayName: 'Mobile Runtime',
        expectedCloudDisplayNameVersion: 1
      }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer token'
      }
    })
    expect(init.headers).not.toHaveProperty('Idempotency-Key')
    vi.unstubAllGlobals()
  })

  it('loads every cursor page and keeps the latest duplicate row', async () => {
    const first = runtime('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1)
    const latest = runtime(first.runtimeRecordId, 2)
    const second = runtime('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1)
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [first], nextCursor: 'next' })
      .mockResolvedValueOnce({ items: [latest, second], nextCursor: null })

    await expect(loadAllAccountRuntimes(session, fetchPage)).resolves.toEqual([latest, second])
    expect(fetchPage).toHaveBeenNthCalledWith(1, null)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'next')
  })

  it('rejects a repeated cursor instead of looping forever', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextCursor: 'same' })

    await expect(loadAllAccountRuntimes(session, fetchPage)).rejects.toThrow(
      'runtime_directory_cursor_cycle'
    )
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('rejects a directory response containing more than 10,000 entries', async () => {
    const entry = runtime('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1)
    const fetchPage = vi.fn().mockResolvedValue({
      items: Array.from({ length: 10_001 }, () => entry),
      nextCursor: null
    })

    await expect(loadAllAccountRuntimes(session, fetchPage)).rejects.toThrow(
      'runtime_directory_response_too_large'
    )
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('rejects a directory response that continues beyond 100 pages', async () => {
    let page = 0
    const fetchPage = vi.fn().mockImplementation(async () => ({
      items: [],
      nextCursor: `page-${++page}`
    }))

    await expect(loadAllAccountRuntimes(session, fetchPage)).rejects.toThrow(
      'runtime_directory_page_limit_exceeded'
    )
    expect(fetchPage).toHaveBeenCalledTimes(100)
  })
})
