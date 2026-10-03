import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OrcaCloudSession } from './profile-cloud-session-store'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
  encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret')
}))

let userDataPath = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  },
  safeStorage: safeStorageMock
}))

async function loadSessionStore() {
  vi.resetModules()
  return import('./profile-cloud-session-store')
}

function makeSession(): OrcaCloudSession {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: 9_999,
    organizations: [
      { orgId: 'org-1', name: 'Acme', role: 'Admin' },
      { orgId: 'org-2', name: 'Personal' }
    ],
    capabilities: {
      flags: { share: true },
      refreshedAt: 123
    }
  }
}

function writePlaintextSessionFile(profileId: string, session: OrcaCloudSession): void {
  const profileDirectory = join(userDataPath, 'profiles', profileId)
  mkdirSync(profileDirectory, { recursive: true })
  writeFileSync(
    join(profileDirectory, 'account-session.json.enc'),
    JSON.stringify(
      {
        version: 1,
        format: 'dev-plaintext-v1',
        savedAt: 1,
        session
      },
      null,
      2
    ),
    'utf-8'
  )
}

function withLinux<T>(run: () => T): T {
  const original = process.platform
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
  }
}

describe('Orca cloud session store', () => {
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-cloud-session-'))
    vi.unstubAllEnvs()
    safeStorageMock.decryptString.mockClear()
    safeStorageMock.encryptString.mockClear()
    safeStorageMock.isEncryptionAvailable.mockClear()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.getSelectedStorageBackend.mockReset()
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  it('persists encrypted sessions and reports encrypted persistence from memory and disk', async () => {
    const store = await loadSessionStore()
    const session = makeSession()

    expect(store.saveOrcaCloudSession('profile-1', userDataPath, session)).toBe('encrypted')
    expect(store.readOrcaCloudSession('profile-1', userDataPath)).toEqual({
      status: 'found',
      session,
      persistence: 'encrypted'
    })

    const reloaded = await loadSessionStore()
    expect(reloaded.readOrcaCloudSession('profile-1', userDataPath)).toEqual({
      status: 'found',
      session,
      persistence: 'encrypted'
    })
  })

  it('falls back to memory-only when encryption is unavailable and plaintext is not allowed', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadSessionStore()
    const session = makeSession()

    expect(store.saveOrcaCloudSession('profile-1', userDataPath, session)).toBe('memory-only')
    expect(store.readOrcaCloudSession('profile-1', userDataPath)).toEqual({
      status: 'found',
      session,
      persistence: 'memory-only'
    })

    const reloaded = await loadSessionStore()
    expect(reloaded.readOrcaCloudSession('profile-1', userDataPath)).toEqual({
      status: 'missing',
      persistence: 'none'
    })
  })

  it.each([
    { label: 'basic_text', backend: 'basic_text' },
    { label: 'unknown', backend: 'unknown' },
    { label: 'a failed probe', backend: null }
  ])('keeps a new session in memory with Linux $label storage', async ({ backend }) => {
    vi.stubEnv('ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION', '1')
    vi.stubEnv('NODE_ENV', 'development')
    if (backend === null) {
      safeStorageMock.getSelectedStorageBackend.mockImplementation(() => {
        throw new Error('backend probe failed')
      })
    } else {
      safeStorageMock.getSelectedStorageBackend.mockReturnValue(backend)
    }
    const store = await loadSessionStore()
    const session = makeSession()

    expect(withLinux(() => store.saveOrcaCloudSession('profile-1', userDataPath, session))).toBe(
      'memory-only'
    )
    expect(store.readOrcaCloudSession('profile-1', userDataPath)).toMatchObject({
      status: 'found',
      session,
      persistence: 'memory-only'
    })
    expect(existsSync(store.getOrcaCloudSessionPath('profile-1', userDataPath))).toBe(false)
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
  })

  it('still decrypts an existing session when the Linux backend later becomes weak', async () => {
    const session = makeSession()
    const store = await loadSessionStore()
    expect(store.saveOrcaCloudSession('profile-1', userDataPath, session)).toBe('encrypted')

    const reloaded = await loadSessionStore()
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('basic_text')
    expect(withLinux(() => reloaded.readOrcaCloudSession('profile-1', userDataPath))).toEqual({
      status: 'found',
      session,
      persistence: 'encrypted'
    })
  })

  it('scopes memory-only sessions by user-data path and profile ID', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const otherUserDataPath = mkdtempSync(join(tmpdir(), 'orca-cloud-session-other-'))
    const store = await loadSessionStore()
    const session = makeSession()
    const otherSession = { ...session, accessToken: 'other-access-token' }

    try {
      store.saveOrcaCloudSession('local-default', userDataPath, session)
      store.saveOrcaCloudSession('local-default', otherUserDataPath, otherSession)

      expect(store.readOrcaCloudSession('local-default', userDataPath)).toMatchObject({
        status: 'found',
        session
      })
      expect(store.readOrcaCloudSession('local-default', otherUserDataPath)).toMatchObject({
        status: 'found',
        session: otherSession
      })
    } finally {
      rmSync(otherUserDataPath, { recursive: true, force: true })
    }
  })

  it('bounds memory-session cache churn', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadSessionStore()
    const session = makeSession()

    for (let index = 0; index < store.MAX_MEMORY_CLOUD_SESSIONS + 4; index += 1) {
      store.saveOrcaCloudSession(`profile-${index}`, userDataPath, session)
    }

    expect(store.getOrcaCloudMemorySessionCountForTests()).toBe(store.MAX_MEMORY_CLOUD_SESSIONS)
  })

  it('keeps a new session in memory even when the old dev plaintext switch is enabled', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    vi.stubEnv('ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION', '1')
    vi.stubEnv('NODE_ENV', 'development')
    const store = await loadSessionStore()
    const session = makeSession()

    expect(store.saveOrcaCloudSession('profile-1', userDataPath, session)).toBe('memory-only')
    expect(existsSync(store.getOrcaCloudSessionPath('profile-1', userDataPath))).toBe(false)

    const reloaded = await loadSessionStore()
    expect(reloaded.readOrcaCloudSession('profile-1', userDataPath)).toEqual({
      status: 'missing',
      persistence: 'none'
    })
  })

  it('reads an existing dev plaintext session only under the old development guard', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    vi.stubEnv('ORCA_CLOUD_ALLOW_PLAINTEXT_SESSION', '1')
    vi.stubEnv('NODE_ENV', 'development')
    const session = makeSession()
    writePlaintextSessionFile('profile-1', session)
    const store = await loadSessionStore()

    expect(store.readOrcaCloudSession('profile-1', userDataPath)).toEqual({
      status: 'found',
      session,
      persistence: 'dev-plaintext'
    })
  })

  it('rejects dev plaintext files when the escape hatch is disabled', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    writePlaintextSessionFile('profile-1', makeSession())
    const store = await loadSessionStore()

    expect(store.readOrcaCloudSession('profile-1', userDataPath)).toEqual({
      status: 'decrypt-failed',
      persistence: 'none',
      error: 'Unsafe session format.'
    })
  })
})
