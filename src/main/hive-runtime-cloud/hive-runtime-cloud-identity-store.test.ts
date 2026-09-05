import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/secret-store', () => ({
  getSecretStore: () => ({ ...safeStorageMock, describeProtectionGap: () => null })
}))

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
}))

vi.mock('electron', () => ({ safeStorage: safeStorageMock }))

import { getOrCreateHiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'

let userDataPath: string

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'hive-runtime-cloud-identity-'))
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
})
afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

describe('Hive Runtime Cloud identity store', () => {
  it('creates one stable dedicated Ed25519 identity in its own secure envelope', () => {
    const first = getOrCreateHiveRuntimeCloudIdentity(userDataPath, 1_700_000_000_000)
    const second = getOrCreateHiveRuntimeCloudIdentity(userDataPath, 1_800_000_000_000)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      status: 'ok',
      identity: { schemaVersion: 1, createdAt: 1_700_000_000_000 }
    })
    expect(existsSync(join(userDataPath, 'hive-runtime-cloud', 'runtime-identity.v1.enc'))).toBe(
      true
    )
    expect(existsSync(join(userDataPath, 'hive-account', 'device-identity.v1.enc'))).toBe(false)
  })

  it('fails closed instead of creating plaintext identity material', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)

    expect(getOrCreateHiveRuntimeCloudIdentity(userDataPath)).toEqual({ status: 'unavailable' })
    expect(existsSync(join(userDataPath, 'hive-runtime-cloud'))).toBe(false)
  })
})
