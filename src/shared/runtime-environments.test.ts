import { describe, expect, it } from 'vitest'
import type { PairingOffer } from './pairing'
import { createEnvironmentFromPairingOffer, getPreferredPairingOffer } from './runtime-environments'

const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const offer: PairingOffer = {
  v: 2,
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'device-token',
  publicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  runtimeRecordId
}

describe('Runtime environment pairing identity', () => {
  it('round-trips a Runtime record id proven by authenticated status', () => {
    const environment = createEnvironmentFromPairingOffer({
      id: 'environment-1',
      name: 'Workstation',
      now: 1,
      offer,
      authenticatedRuntimeRecordId: runtimeRecordId
    })

    expect(environment.runtimeRecordId).toBe(runtimeRecordId)
    expect(getPreferredPairingOffer(environment)).toMatchObject({ runtimeRecordId })
  })

  it('does not persist a Runtime record id carried only by the pairing offer', () => {
    const environment = createEnvironmentFromPairingOffer({
      id: 'environment-1',
      name: 'Workstation',
      now: 1,
      offer
    })

    expect(environment).not.toHaveProperty('runtimeRecordId')
  })

  it('keeps legacy environments and offers valid when the account identity is absent', () => {
    const { runtimeRecordId: _runtimeRecordId, ...legacyOffer } = offer
    const environment = createEnvironmentFromPairingOffer({
      id: 'environment-1',
      name: 'Workstation',
      now: 1,
      offer: legacyOffer
    })

    expect(environment).not.toHaveProperty('runtimeRecordId')
    expect(getPreferredPairingOffer(environment)).not.toHaveProperty('runtimeRecordId')
  })
})
