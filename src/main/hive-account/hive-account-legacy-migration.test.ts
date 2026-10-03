import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateLegacyOrcaCloudIdentity } from './hive-account-legacy-migration'
import {
  getOrcaProfileDirectory,
  getOrcaProfileIndexPath
} from '../orca-profiles/profile-index-store'

let userDataPath: string

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), 'hive-account-migration-'))
})

afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

describe('legacy Orca cloud identity migration', () => {
  it('preserves local profiles while invalidating compatibility identity and sessions', () => {
    const profile = {
      id: 'cloud-profile',
      name: 'Work',
      avatar: { kind: 'initials', initials: 'W', color: 'neutral' },
      kind: 'cloud-linked',
      createdAt: 1,
      updatedAt: 2,
      lastOpenedAt: 3,
      cloud: {
        cloudProfileId: 'legacy-cloud-profile',
        userId: 'legacy-user',
        email: 'legacy@example.com',
        linkedAt: 4
      }
    }
    const indexPath = getOrcaProfileIndexPath(userDataPath)
    mkdirSync(join(indexPath, '..'), { recursive: true })
    writeFileSync(
      indexPath,
      JSON.stringify({ schemaVersion: 1, activeProfileId: profile.id, profiles: [profile] })
    )
    const profileDirectory = getOrcaProfileDirectory(profile.id, userDataPath)
    mkdirSync(profileDirectory, { recursive: true })
    const sessionPath = join(profileDirectory, 'account-session.json.enc')
    writeFileSync(sessionPath, 'legacy-encrypted-session')

    migrateLegacyOrcaCloudIdentity(userDataPath)

    const migrated = JSON.parse(readFileSync(indexPath, 'utf8'))
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      activeProfileId: profile.id,
      profiles: [{ id: profile.id, name: 'Work', kind: 'local' }]
    })
    expect(migrated.profiles[0]).not.toHaveProperty('cloud')
    expect(existsSync(sessionPath)).toBe(false)
  })
})
