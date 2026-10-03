import { createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/secret-store', () => ({ getSecretStore: () => safeStorageMock }))

const safeStorageMock = vi.hoisted(() => ({
  available: true,
  describeProtectionGap: vi.fn<() => string | null>(() => null),
  isEncryptionAvailable: vi.fn(() => safeStorageMock.available),
  encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8'))
}))

vi.mock('electron', () => ({ safeStorage: safeStorageMock }))

import { getOrCreateHiveDeviceIdentity, signHiveDeviceAuthorization } from './hive-account-device'
import {
  readHiveAccountSession,
  saveHiveAccountSession,
  type HiveAccountSession
} from './hive-account-session-store'

let userDataPath: string

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'hive-account-store-'))
  safeStorageMock.available = true
  safeStorageMock.describeProtectionGap.mockReturnValue(null)
  safeStorageMock.isEncryptionAvailable.mockClear()
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.decryptString.mockClear()
})

afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

describe('Hive account secure identity and session storage', () => {
  it('refuses a host store that can round-trip but reports no real keyring protection', () => {
    safeStorageMock.describeProtectionGap.mockReturnValue('basic_text obfuscation')
    expect(getOrCreateHiveDeviceIdentity(userDataPath).status).toBe('unavailable')
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
  })
  it('creates one stable Ed25519 identity and signs the canonical proof', () => {
    const first = getOrCreateHiveDeviceIdentity(userDataPath)
    const second = getOrCreateHiveDeviceIdentity(userDataPath)
    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
    if (first.status !== 'ok' || second.status !== 'ok') {
      return
    }
    expect(second.identity.publicKey).toBe(first.identity.publicKey)

    const signature = signHiveDeviceAuthorization(
      first.identity,
      'nonce',
      'hivecode-desktop',
      'TRUSTED'
    )
    const publicKey = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: first.identity.publicKey },
      format: 'jwk'
    })
    const canonical = `hive-device-authorization-v2\nnonce\nhivecode-desktop\n${first.identity.deviceLabel}\nTRUSTED`
    expect(
      verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, 'base64url'))
    ).toBe(true)
  })

  it('never writes session tokens as plaintext and fails closed without safeStorage', () => {
    const session: HiveAccountSession = {
      schemaVersion: 2,
      accessToken: 'secret-access-token',
      refreshToken: 'secret-refresh-token',
      expiresAt: Date.now() + 60_000,
      sessionExpiresAt: Date.now() + 90 * 24 * 60 * 60 * 1_000,
      sessionProfile: 'TRUSTED',
      account: { accountId: '123e4567-e89b-42d3-a456-426614174000', displayName: 'Ada' },
      authorityId: 'hive-primary',
      deviceLabel: 'desktop',
      generation: 1,
      savedAt: Date.now()
    }
    expect(saveHiveAccountSession(userDataPath, session)).toBe(true)
    const raw = readFileSync(join(userDataPath, 'hive-account', 'native-session.v1.enc'), 'utf8')
    expect(raw).not.toContain('secret-access-token')
    expect(readHiveAccountSession(userDataPath)).toEqual({ status: 'ok', value: session })

    safeStorageMock.available = false
    expect(readHiveAccountSession(userDataPath)).toEqual({ status: 'unavailable' })
    expect(getOrCreateHiveDeviceIdentity(join(userDataPath, 'new'))).toEqual({
      status: 'unavailable'
    })
  })
})
