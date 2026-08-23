import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'
import { bestEffortFsyncDirectorySync, fsyncFileSync } from '../../shared/secure-file'

type ProtectedEnvelope = {
  schemaVersion: 1
  ciphertext: string
}

export type SecureReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'unavailable' }
  | { status: 'unreadable' }

export function hiveAccountStorageDirectory(userDataPath: string): string {
  return join(userDataPath, 'hive-account')
}

export function isHiveAccountEncryptionAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return false
    }
    // Why: Electron's Linux basic_text backend only obfuscates credentials.
    // Cloud identity must remain disabled unless the OS provides a real keyring.
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

export function readSecureJson<T>(
  path: string,
  validate: (value: unknown) => value is T
): SecureReadResult<T> {
  if (!existsSync(path)) {
    return { status: 'missing' }
  }
  if (!isHiveAccountEncryptionAvailable()) {
    return { status: 'unavailable' }
  }
  try {
    const envelope = JSON.parse(readFileSync(path, 'utf8')) as ProtectedEnvelope
    if (
      envelope?.schemaVersion !== 1 ||
      typeof envelope.ciphertext !== 'string' ||
      !envelope.ciphertext
    ) {
      return { status: 'unreadable' }
    }
    const plaintext = safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'))
    const value: unknown = JSON.parse(plaintext)
    return validate(value) ? { status: 'ok', value } : { status: 'unreadable' }
  } catch {
    return { status: 'unreadable' }
  }
}

export function writeSecureJson(path: string, value: unknown): boolean {
  if (!isHiveAccountEncryptionAvailable()) {
    return false
  }
  const temporaryPath = `${path}.tmp`
  try {
    const directory = dirname(path)
    mkdirSync(directory, { recursive: true })
    const envelope: ProtectedEnvelope = {
      schemaVersion: 1,
      ciphertext: safeStorage.encryptString(JSON.stringify(value)).toString('base64')
    }
    writeFileSync(temporaryPath, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 })
    fsyncFileSync(temporaryPath)
    renameSync(temporaryPath, path)
    try {
      chmodSync(path, 0o600)
    } catch {
      // Windows ACLs are inherited from userData; chmod is best effort there.
    }
    bestEffortFsyncDirectorySync(directory)
    return true
  } catch {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // The temporary envelope may not have been created yet.
    }
    return false
  }
}

export function deleteSecureJson(path: string): void {
  try {
    unlinkSync(path)
    bestEffortFsyncDirectorySync(dirname(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export function hiveAccountSecurePath(userDataPath: string, fileName: string): string {
  return join(hiveAccountStorageDirectory(userDataPath), fileName)
}
