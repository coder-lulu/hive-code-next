import { describe, expect, it } from 'vitest'
import {
  parseRuntimeDisplayMetadata,
  parseRuntimeWebSessionDisplayMetadata
} from './runtime-display-metadata'

const runtimeRecordId = '523e4567-e89b-42d3-a456-426614174000'
const metadata = {
  runtimeRecordId,
  resourceVersion: 7,
  ownershipEpoch: 2,
  cloudDisplayName: '<备用> 🐝',
  cloudDisplayNameVersion: 4,
  deviceName: '设备'
}

describe('session-bound Runtime display metadata', () => {
  it('accepts confirmed text and explicit alias clearing without widening the grant', () => {
    expect(parseRuntimeDisplayMetadata(metadata)).toEqual(metadata)
    expect(parseRuntimeDisplayMetadata({ ...metadata, cloudDisplayName: null })).toMatchObject({
      cloudDisplayName: null
    })
  })

  it.each([
    { ...metadata, accountId: runtimeRecordId },
    { ...metadata, ownershipEpoch: undefined },
    { ...metadata, ownershipEpoch: 0 },
    { ...metadata, cloudDisplayNameVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...metadata, resourceVersion: 1.5 },
    { ...metadata, cloudDisplayName: ' raw ' },
    { ...metadata, cloudDisplayName: 'e\u0301' },
    { ...metadata, cloudDisplayName: '\u202eunsafe' },
    { ...metadata, cloudDisplayName: '\ud800' }
  ])('rejects unbound, unsafe and noncanonical projection %#', (value) => {
    expect(() => parseRuntimeDisplayMetadata(value)).toThrow(
      'runtime_display_metadata_response_invalid'
    )
  })

  it('requires the exact current protocol, ACTIVE status and bound session IDs', () => {
    const response = {
      protocolVersion: 'web-session-display-metadata/v1',
      managedWebSessionId: '223e4567-e89b-42d3-a456-426614174000',
      runtimeSessionId: '323e4567-e89b-42d3-a456-426614174000',
      status: 'ACTIVE',
      controlVersion: 3,
      runtimeDisplayMetadata: metadata
    }
    expect(parseRuntimeWebSessionDisplayMetadata(response)).toEqual(response)
    for (const invalid of [
      { ...response, protocolVersion: 'web-session-display-metadata/v2' },
      { ...response, status: 'REVOKE_PENDING' },
      { ...response, sessionToken: 'credential' },
      { ...response, runtimeSessionId: runtimeRecordId.toUpperCase() }
    ]) {
      expect(() => parseRuntimeWebSessionDisplayMetadata(invalid)).toThrow()
    }
  })
})
