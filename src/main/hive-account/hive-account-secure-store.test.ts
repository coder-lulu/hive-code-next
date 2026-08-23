import { createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  available: true,
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
  safeStorageMock.isEncryptionAvailable.mockClear()
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.decryptString.mockClear()
})

afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

describe('Hive account secure identity and session storage', () => {
  it('creates one stable Ed25519 identity and signs the canonical proof', () => {
    const first = getOrCreateHiveDeviceIdentity(userDataPath)
    const second = getOrCreateHiveDeviceIdentity(userDataPath)
    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
    if (first.status !== 'ok' || second.status !== 'ok') {
      return
    }
    expect(second.identity.publicKey).toBe(first.identity.publicKey)

    const signature = signHiveDeviceAuthorization(first.identity, 'nonce', 'hivecode-desktop')
    const publicKey = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: first.identity.publicKey },
      format: 'jwk'
    })
    const canonical = `hive-device-authorization-v1\nnonce\nhivecode-desktop\n${first.identity.deviceLabel}`
    expect(
      verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, 'base64url'))
    ).toBe(true)
  })

  it('never writes session tokens as plaintext and fails closed without safeStorage', () => {
    const session: HiveAccountSession = {
      schemaVersion: 1,
      accessToken: 'secret-access-token',
      refreshToken: 'secret-refresh-token',
      expiresAt: Date.now() + 60_000,
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
