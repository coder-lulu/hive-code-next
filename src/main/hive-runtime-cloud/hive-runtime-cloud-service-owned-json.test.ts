import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteHiveRuntimeServiceOwnedJson,
  readHiveRuntimeServiceOwnedJson,
  writeHiveRuntimeServiceOwnedJson
} from './hive-runtime-cloud-service-owned-json'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Hive Runtime service-owned JSON', () => {
  it('persists a headless identity as a service-owned file and can remove it', () => {
    const root = mkdtempSync(join(tmpdir(), 'hive-runtime-service-'))
    temporaryDirectories.push(root)
    const path = join(root, 'identity', 'runtime-identity.v1.json')
    const value = { schemaVersion: 1, secret: 'service-only' }
    const validate = (candidate: unknown): candidate is typeof value =>
      Boolean(
        candidate &&
        typeof candidate === 'object' &&
        (candidate as typeof value).schemaVersion === 1 &&
        (candidate as typeof value).secret === 'service-only'
      )

    expect(writeHiveRuntimeServiceOwnedJson(path, value)).toBe(true)
    expect(readHiveRuntimeServiceOwnedJson(path, validate)).toEqual({ status: 'ok', value })
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(statSync(join(root, 'identity')).mode & 0o777).toBe(0o700)
    }

    deleteHiveRuntimeServiceOwnedJson(path)
    expect(readHiveRuntimeServiceOwnedJson(path, validate)).toEqual({ status: 'missing' })
  })
})
