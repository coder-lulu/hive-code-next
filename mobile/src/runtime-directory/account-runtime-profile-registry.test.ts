import { afterEach, describe, expect, it } from 'vitest'
import type { HostProfile } from '../transport/types'
import {
  mergeAccountRuntimeProfiles,
  replaceAccountRuntimeProfiles,
  resetAccountRuntimeProfileRegistryForTests
} from './account-runtime-profile-registry'

const profile = (id: string, runtimeRecordId?: string): HostProfile => ({
  id,
  name: id,
  endpoint: `cloud://${id}`,
  deviceToken: '',
  publicKeyB64: '',
  lastConnected: 0,
  runtimeRecordId
})

describe('account Runtime profile registry', () => {
  afterEach(resetAccountRuntimeProfileRegistryForTests)

  it('makes account profiles available without persisting them', () => {
    const cloud = profile('cloud', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    replaceAccountRuntimeProfiles([cloud])
    expect(mergeAccountRuntimeProfiles([])).toEqual([cloud])
  })

  it('keeps the local pairing route when the explicit Runtime id matches', () => {
    const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const local = profile('local', runtimeRecordId)
    const accountRuntime = {
      runtimeRecordId,
      resourceVersion: 4,
      createConnection: async () => {
        throw new Error('not used')
      }
    }
    replaceAccountRuntimeProfiles([{ ...profile('cloud', runtimeRecordId), accountRuntime }])
    expect(mergeAccountRuntimeProfiles([local])).toEqual([
      { ...local, accountRuntimeFallback: accountRuntime }
    ])
  })

  it('does not deduplicate profiles merely because their names match', () => {
    const local = { ...profile('local'), name: 'Workstation' }
    const cloud = {
      ...profile('cloud', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      name: 'Workstation'
    }
    replaceAccountRuntimeProfiles([cloud])
    expect(mergeAccountRuntimeProfiles([local])).toEqual([local, cloud])
  })
})
