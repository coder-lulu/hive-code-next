import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
}))

vi.mock('electron', () => ({ safeStorage: safeStorageMock }))

import {
  readHiveRuntimeCloudRegistrationState,
  saveHiveRuntimeCloudRegistrationState
} from './hive-runtime-cloud-state-store'

let userDataPath: string

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'hive-runtime-cloud-state-'))
})

afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

describe('Hive Runtime Cloud registration state', () => {
  it('round-trips a pending one-time Claim capability only through safeStorage', () => {
    const state = {
      schemaVersion: 1 as const,
      runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
      status: 'PENDING_CLAIM' as const,
      resourceVersion: 1,
      authorityGeneration: 1,
      fencingEpoch: 1,
      latestLeaseEpoch: 0,
      claimCapability: 'c'.repeat(64),
      claimExpiresAt: 1_900_000_000_000
    }

    expect(saveHiveRuntimeCloudRegistrationState(userDataPath, state)).toBe(true)
    expect(readHiveRuntimeCloudRegistrationState(userDataPath)).toEqual({
      status: 'ok',
      value: state
    })
    expect(safeStorageMock.encryptString).toHaveBeenCalledOnce()
  })

  it('rejects claimed state that accidentally retains the Claim capability', () => {
    expect(
      saveHiveRuntimeCloudRegistrationState(userDataPath, {
        schemaVersion: 1,
        runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
        status: 'CLAIMED',
        resourceVersion: 2,
        authorityGeneration: 1,
        fencingEpoch: 1,
        latestLeaseEpoch: 0,
        ownerAccountId: '223e4567-e89b-42d3-a456-426614174000',
        claimCapability: 'c'.repeat(64)
      } as never)
    ).toBe(false)
  })

  it('rejects pending state that accidentally retains an activation credential', () => {
    expect(
      saveHiveRuntimeCloudRegistrationState(userDataPath, {
        schemaVersion: 1,
        runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
        status: 'PENDING_CLAIM',
        resourceVersion: 1,
        authorityGeneration: 1,
        fencingEpoch: 1,
        latestLeaseEpoch: 0,
        claimCapability: 'c'.repeat(64),
        claimExpiresAt: 1_900_000_000_000,
        credentialActivationToken: 'activation-secret'.repeat(3)
      } as never)
    ).toBe(false)
  })
})
