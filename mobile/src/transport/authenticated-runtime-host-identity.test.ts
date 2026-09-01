import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  hosts: [] as Array<Record<string, unknown>>,
  drop: vi.fn(),
  write: vi.fn()
}))

vi.mock('./host-list-load-sharing', () => ({
  dropSharedHostListLoad: storage.drop
}))
vi.mock('./host-metadata-store', () => ({
  readStoredHostProfilesForMutation: vi.fn(async () => storage.hosts),
  writeStoredHostProfiles: storage.write
}))

import {
  commitAuthenticatedRuntimeRecordId,
  HostRuntimeIdentityMismatchError
} from './authenticated-runtime-host-identity'

const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const host = {
  id: 'host-1',
  name: 'Host 1',
  endpoint: 'ws://127.0.0.1:1',
  publicKeyB64: 'key',
  lastConnected: 0
}

describe('authenticated Runtime host identity', () => {
  beforeEach(() => {
    storage.hosts = [host]
    storage.drop.mockReset()
    storage.write.mockReset().mockImplementation(async (next) => {
      storage.hosts = next
    })
  })

  it('backfills once without rewriting an unchanged host list', async () => {
    await expect(commitAuthenticatedRuntimeRecordId(host.id, runtimeRecordId)).resolves.toBe(true)
    expect(storage.hosts[0]).toMatchObject({ runtimeRecordId })
    expect(storage.write).toHaveBeenCalledOnce()

    await expect(commitAuthenticatedRuntimeRecordId(host.id, runtimeRecordId)).resolves.toBe(false)
    expect(storage.write).toHaveBeenCalledOnce()
  })

  it('rejects a conflicting identity without mutating the host', async () => {
    storage.hosts = [{ ...host, runtimeRecordId }]

    await expect(
      commitAuthenticatedRuntimeRecordId(host.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    ).rejects.toBeInstanceOf(HostRuntimeIdentityMismatchError)
    expect(storage.write).not.toHaveBeenCalled()
  })
})
