import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { bestEffortFsyncDirectorySync, fsyncFileSync } from '../../shared/secure-file'
import type { SecureReadResult } from '../hive-account/hive-account-secure-store'

const MAXIMUM_SERVICE_JSON_BYTES = 16_384

export function readHiveRuntimeServiceOwnedJson<T>(
  path: string,
  validate: (value: unknown) => value is T,
  maximumBytes = MAXIMUM_SERVICE_JSON_BYTES
): SecureReadResult<T> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    return { status: 'unreadable' }
  }
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) {
      return { status: 'unreadable' }
    }
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return validate(value) ? { status: 'ok', value } : { status: 'unreadable' }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { status: 'missing' }
      : { status: 'unreadable' }
  }
}

export function writeHiveRuntimeServiceOwnedJson(
  path: string,
  value: unknown,
  maximumBytes = MAXIMUM_SERVICE_JSON_BYTES
): boolean {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    return false
  }
  const directory = dirname(path)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') {
      chmodSync(directory, 0o700)
    }
    const payload = JSON.stringify(value)
    if (Buffer.byteLength(payload, 'utf8') > maximumBytes) {
      return false
    }
    writeFileSync(temporaryPath, payload, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    fsyncFileSync(temporaryPath)
    renameSync(temporaryPath, path)
    if (process.platform !== 'win32') {
      chmodSync(path, 0o600)
    }
    bestEffortFsyncDirectorySync(directory)
    return true
  } catch {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // The temporary file may not have been created.
    }
    return false
  }
}

export function deleteHiveRuntimeServiceOwnedJson(path: string): void {
  try {
    unlinkSync(path)
    bestEffortFsyncDirectorySync(dirname(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}
