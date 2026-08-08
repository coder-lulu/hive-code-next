import { existsSync, linkSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { MigrationPolicyError, type SanitizedMigrationSource } from './user-data-migration-policy'
import {
  ACTIVE_VIEW_FILE,
  assertExistingSafeDirectory,
  BACKUP_MANIFEST,
  DATA_FILE,
  fsyncDirectory,
  MAX_ACTIVE_VIEW_BYTES,
  MAX_PROFILE_DATA_BYTES,
  MIGRATION_VERSION,
  parseManifest,
  PROFILE_INDEX_FILE,
  PROFILES_DIRECTORY,
  readControlFile,
  readSafeFile,
  serialize,
  sha256,
  writeAtomicFile,
  writeNewFile,
  type MigrationHooks,
  type MigrationManifest
} from './user-data-migration-journal'
import {
  targetArtifactsMatch,
  targetIndexMatches,
  targetProfilesMatch
} from './user-data-migration-target-integrity'

export { targetArtifactsMatch } from './user-data-migration-target-integrity'

export type MigrationBackup = {
  manifest: MigrationManifest
  profileIndex: string
  profiles: Map<string, { data: string; activeView?: string }>
}

function buildProfileIndex(source: SanitizedMigrationSource): string {
  return serialize({
    schemaVersion: 1,
    activeProfileId: source.activeProfileId,
    profiles: source.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
      kind: 'local',
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastOpenedAt: profile.lastOpenedAt
    }))
  })
}

export function createMigrationBackup(
  target: string,
  backupDirectoryName: string,
  source: SanitizedMigrationSource,
  hooks?: MigrationHooks
): MigrationManifest {
  const backup = join(target, backupDirectoryName)
  const staging = `${backup}.staging.${process.pid}.${randomUUID()}`
  const profileIndex = buildProfileIndex(source)
  const manifest: MigrationManifest = {
    schemaVersion: MIGRATION_VERSION,
    migrationId: randomUUID(),
    createdAt: new Date().toISOString(),
    profileIndexSha256: sha256(profileIndex),
    profiles: source.profiles.map((profile) => ({
      id: profile.id,
      dataSha256: sha256(profile.data),
      ...(profile.activeView ? { activeViewSha256: sha256(profile.activeView) } : {})
    }))
  }
  try {
    mkdirSync(staging, { recursive: false, mode: 0o700 })
    writeNewFile(join(staging, PROFILE_INDEX_FILE), profileIndex)
    for (const profile of source.profiles) {
      const profileDirectory = join(staging, PROFILES_DIRECTORY, profile.id)
      writeNewFile(join(profileDirectory, DATA_FILE), profile.data)
      if (profile.activeView) {
        writeNewFile(join(profileDirectory, ACTIVE_VIEW_FILE), profile.activeView)
      }
      fsyncDirectory(profileDirectory)
    }
    fsyncDirectory(join(staging, PROFILES_DIRECTORY))
    writeNewFile(join(staging, BACKUP_MANIFEST), serialize(manifest))
    fsyncDirectory(staging)
    hooks?.beforeStep?.('before-backup-commit')
    renameSync(staging, backup)
    fsyncDirectory(target)
    return manifest
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export function readMigrationBackup(target: string, backupDirectoryName: string): MigrationBackup {
  const backup = join(target, backupDirectoryName)
  assertExistingSafeDirectory(backup)
  const manifest = parseManifest(
    JSON.parse(readControlFile(join(backup, BACKUP_MANIFEST))) as unknown
  )
  const profileIndex = readControlFile(join(backup, PROFILE_INDEX_FILE))
  if (sha256(profileIndex) !== manifest.profileIndexSha256) {
    throw new MigrationPolicyError('invalid-source')
  }
  const profiles = new Map<string, { data: string; activeView?: string }>()
  for (const expected of manifest.profiles) {
    const profileDirectory = join(backup, PROFILES_DIRECTORY, expected.id)
    assertExistingSafeDirectory(profileDirectory)
    const data = readSafeFile(join(profileDirectory, DATA_FILE), MAX_PROFILE_DATA_BYTES)
    if (sha256(data) !== expected.dataSha256) {
      throw new MigrationPolicyError('invalid-source')
    }
    const activeViewFile = join(profileDirectory, ACTIVE_VIEW_FILE)
    let activeView: string | undefined
    if (expected.activeViewSha256) {
      activeView = readSafeFile(activeViewFile, MAX_ACTIVE_VIEW_BYTES)
      if (sha256(activeView) !== expected.activeViewSha256) {
        throw new MigrationPolicyError('invalid-source')
      }
    } else if (existsSync(activeViewFile)) {
      throw new MigrationPolicyError('invalid-source')
    }
    profiles.set(expected.id, { data, ...(activeView ? { activeView } : {}) })
  }
  return { manifest, profileIndex, profiles }
}

export function targetManagedDataExists(target: string): boolean {
  return [PROFILE_INDEX_FILE, DATA_FILE, PROFILES_DIRECTORY].some((name) =>
    existsSync(join(target, name))
  )
}

export function targetProfileStructureIsSafe(target: string): boolean {
  try {
    if (existsSync(join(target, DATA_FILE))) {
      return false
    }
    const index = JSON.parse(readControlFile(join(target, PROFILE_INDEX_FILE))) as {
      activeProfileId?: unknown
    }
    if (
      typeof index.activeProfileId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(index.activeProfileId)
    ) {
      return false
    }
    const profilesDirectory = join(target, PROFILES_DIRECTORY)
    const profileDirectory = join(profilesDirectory, index.activeProfileId)
    assertExistingSafeDirectory(profilesDirectory)
    assertExistingSafeDirectory(profileDirectory)
    readSafeFile(join(profileDirectory, DATA_FILE), MAX_PROFILE_DATA_BYTES)
    return true
  } catch {
    return false
  }
}

function writePreparedJournal(
  target: string,
  markerFileName: string,
  manifest: MigrationManifest,
  hooks?: MigrationHooks
): void {
  hooks?.beforeStep?.('before-journal-commit')
  writeAtomicFile(join(target, markerFileName), serialize({ ...manifest, status: 'prepared' }))
}

export function commitMigrationBackup(
  target: string,
  markerFileName: string,
  stagingPrefix: string,
  backup: MigrationBackup,
  hooks?: MigrationHooks
): number {
  const staging = join(target, `${stagingPrefix}.${process.pid}.${randomUUID()}`)
  const targetProfiles = join(target, PROFILES_DIRECTORY)
  const targetIndex = join(target, PROFILE_INDEX_FILE)
  let journalWritten = false
  let profilesCommitted = false
  let indexCommitted = false
  try {
    mkdirSync(staging, { recursive: false, mode: 0o700 })
    writeNewFile(join(staging, PROFILE_INDEX_FILE), backup.profileIndex)
    for (const [profileId, files] of backup.profiles) {
      const profileDirectory = join(staging, PROFILES_DIRECTORY, profileId)
      writeNewFile(join(profileDirectory, DATA_FILE), files.data)
      if (files.activeView) {
        writeNewFile(join(profileDirectory, ACTIVE_VIEW_FILE), files.activeView)
      }
      fsyncDirectory(profileDirectory)
    }
    fsyncDirectory(join(staging, PROFILES_DIRECTORY))
    fsyncDirectory(staging)
    writePreparedJournal(target, markerFileName, backup.manifest, hooks)
    journalWritten = true
    hooks?.beforeStep?.('before-profiles-commit')
    renameSync(join(staging, PROFILES_DIRECTORY), targetProfiles)
    profilesCommitted = true
    fsyncDirectory(target)
    hooks?.beforeStep?.('before-index-commit')
    const stagedIndex = join(staging, PROFILE_INDEX_FILE)
    linkSync(stagedIndex, targetIndex)
    indexCommitted = true
    unlinkSync(stagedIndex)
    fsyncDirectory(target)
    hooks?.beforeStep?.('before-post-commit-validation')
    if (targetArtifactsMatch(target, backup.manifest) !== 'match') {
      throw new Error('target-artifacts-conflict')
    }
    return (
      1 +
      backup.manifest.profiles.reduce(
        (count, profile) => count + 1 + (profile.activeViewSha256 ? 1 : 0),
        0
      )
    )
  } catch (error) {
    let rollbackComplete = true
    if (indexCommitted) {
      try {
        if (targetIndexMatches(target, backup.manifest)) {
          rmSync(targetIndex, { force: true })
        } else {
          rollbackComplete = false
        }
      } catch {
        rollbackComplete = false
      }
    }
    if (profilesCommitted) {
      try {
        if (targetProfilesMatch(target, backup.manifest)) {
          rmSync(targetProfiles, { recursive: true, force: true })
        } else {
          rollbackComplete = false
        }
      } catch {
        rollbackComplete = false
      }
    }
    if (journalWritten && rollbackComplete) {
      rmSync(join(target, markerFileName), { force: true })
    }
    throw error
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
