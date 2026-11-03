import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetSecretStoreForTests, setSecretStore } from '../shared/secret-store'
import {
  CredentialProtectionUnavailableError,
  writeEncryptedCredential
} from './integration-credential-file'

const roots: string[] = []

afterEach(() => {
  _resetSecretStoreForTests()
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('new integration credential protection', () => {
  it.each(['unavailable', 'weak', 'probe-failure'] as const)(
    'refuses %s storage without replacing a saved credential',
    (mode) => {
      const root = mkdtempSync(join(tmpdir(), 'hive-credential-protection-'))
      roots.push(root)
      const file = join(root, 'credential.enc')
      const previous = Buffer.from([0x00, 0x91, 0x42])
      writeFileSync(file, previous)
      const encryptString = vi.fn(() => Buffer.from('sealed'))
      setSecretStore({
        isEncryptionAvailable: () => mode !== 'unavailable',
        describeProtectionGap: () => {
          if (mode === 'probe-failure') throw new Error('keyring probe failed')
          return mode === 'weak' ? 'basic_text' : null
        },
        encryptString,
        decryptString: () => 'unused'
      })

      expect(() => writeEncryptedCredential('Bitbucket', file, 'secret-token')).toThrow(
        CredentialProtectionUnavailableError
      )
      expect(encryptString).not.toHaveBeenCalled()
      expect(readFileSync(file)).toEqual(previous)
    }
  )
})
