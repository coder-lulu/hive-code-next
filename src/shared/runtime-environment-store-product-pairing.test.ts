import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodePairingOffer } from './pairing'
import {
  addEnvironmentFromPairingCode,
  listEnvironments,
  markEnvironmentUsed
} from './runtime-environment-store'

describe('Cloud identity from the saved runtime pairing', () => {
  const directories: string[] = []
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  beforeEach(() =>
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
  )
  afterEach(() => {
    if (platform) {
      Object.defineProperty(process, 'platform', platform)
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('ignores a Cloud record identity delivered by an old pairing token', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hive-pairing-identity-'))
    directories.push(directory)
    const environment = addEnvironmentFromPairingCode(directory, {
      name: 'owned host',
      now: 1000,
      pairingCode: encodePairingOffer({
        v: 2,
        endpoint: 'ws://127.0.0.1:6768',
        deviceToken: 'current-token',
        publicKeyB64: Buffer.alloc(32, 1).toString('base64')
      })
    })
    markEnvironmentUsed(directory, environment.id, {
      pairingDeviceToken: 'current-token',
      runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
      now: 2000
    })
    markEnvironmentUsed(directory, environment.id, {
      pairingDeviceToken: 'old-token',
      runtimeRecordId: '123e4567-e89b-42d3-a456-426614174001',
      now: 3000
    })
    expect(listEnvironments(directory)[0]?.runtimeRecordId).toBe(
      '123e4567-e89b-42d3-a456-426614174000'
    )
  })
})
