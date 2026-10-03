import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  isEncryptionAvailable: vi.fn(() => true),
  describeProtectionGap: vi.fn<() => string | null>(() => null)
}))

let tempHome = ''

async function loadStoreModule() {
  vi.resetModules()
  const { setSecretStore } = await import('../../shared/secret-store')
  setSecretStore({ ...safeStorageMock })
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./openai-api-key-store')
}

beforeEach(() => {
  tempHome = mkdtempLike('orca-openai-key-store-')
  safeStorageMock.decryptString.mockClear()
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.isEncryptionAvailable.mockClear()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  safeStorageMock.describeProtectionGap.mockReset()
  safeStorageMock.describeProtectionGap.mockReturnValue(null)
})

function mkdtempLike(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeStoredOpenAiKey(value: string): void {
  const orcaDir = join(tempHome, '.orca')
  mkdirSync(orcaDir, { recursive: true })
  writeFileSync(join(orcaDir, 'openai-speech-token.enc'), value)
}

describe('OpenAI speech API key store', () => {
  it.each([
    { label: 'an unavailable keyring', encryptionAvailable: false, gap: null },
    { label: 'basic_text obfuscation', encryptionAvailable: true, gap: 'basic_text' }
  ])('keeps the existing key when $label cannot protect a replacement', async (options) => {
    writeStoredOpenAiKey('previous-key')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(options.encryptionAvailable)
    safeStorageMock.describeProtectionGap.mockReturnValue(options.gap)
    const store = await loadStoreModule()

    expect(() => store.saveOpenAiSpeechApiKey('new-key')).toThrow(
      'Could not save OpenAI speech API key securely'
    )
    expect(readFileSync(join(tempHome, '.orca', 'openai-speech-token.enc'), 'utf8')).toBe(
      'previous-key'
    )
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
  })

  it('checks configured status without decrypting or touching safeStorage', async () => {
    writeStoredOpenAiKey('encrypted-key')
    const store = await loadStoreModule()

    expect(store.hasOpenAiSpeechApiKey()).toBe(true)
    expect(safeStorageMock.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('decrypts only when the key is read for an API request', async () => {
    writeStoredOpenAiKey('encrypted-key')
    const store = await loadStoreModule()

    expect(store.readOpenAiSpeechApiKey()).toBe('encrypted-key')
    expect(safeStorageMock.decryptString).toHaveBeenCalledOnce()
  })

  it('caches the decrypted key so repeated dictations do not repeatedly touch safeStorage', async () => {
    writeStoredOpenAiKey('encrypted-key')
    const store = await loadStoreModule()

    expect(store.readOpenAiSpeechApiKey()).toBe('encrypted-key')
    expect(store.readOpenAiSpeechApiKey()).toBe('encrypted-key')
    expect(safeStorageMock.decryptString).toHaveBeenCalledOnce()
  })

  it('uses the in-memory key after save without decrypting from safeStorage', async () => {
    const store = await loadStoreModule()

    store.saveOpenAiSpeechApiKey('saved-key')

    expect(store.readOpenAiSpeechApiKey()).toBe('saved-key')
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('reports missing status without creating storage files', async () => {
    const store = await loadStoreModule()

    expect(store.hasOpenAiSpeechApiKey()).toBe(false)
    expect(existsSync(join(tempHome, '.orca'))).toBe(false)
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })
})
