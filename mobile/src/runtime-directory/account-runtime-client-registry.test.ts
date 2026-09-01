import { beforeEach, describe, expect, it } from 'vitest'
import {
  listAccountRuntimeClients,
  registerAccountRuntimeClient,
  resetAccountRuntimeClientRegistryForTests
} from './account-runtime-client-registry'

const registration = {
  hostId: 'local-host',
  runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  resourceVersion: 4,
  accessMode: 'local-fallback' as const
}

describe('account Runtime client registry', () => {
  beforeEach(resetAccountRuntimeClientRegistryForTests)

  it('does not let an older client unregister its replacement', () => {
    const unregisterOlder = registerAccountRuntimeClient(registration)
    const replacement = { ...registration, resourceVersion: 5 }
    const unregisterCurrent = registerAccountRuntimeClient(replacement)

    unregisterOlder()
    expect(listAccountRuntimeClients()).toEqual([replacement])

    unregisterCurrent()
    expect(listAccountRuntimeClients()).toEqual([])
  })

  it('keys clients by their actual host id while retaining account identity metadata', () => {
    registerAccountRuntimeClient(registration)

    expect(listAccountRuntimeClients()).toEqual([registration])
  })
})
