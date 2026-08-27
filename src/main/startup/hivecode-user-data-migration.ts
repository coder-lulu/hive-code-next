import { closeSync, existsSync, fsyncSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  MigrationPolicyError,
  readSanitizedMigrationSource,
  type SanitizedMigrationSource
} from './user-data-migration-policy'
import {
  commitMigrationBackup,
  createMigrationBackup,
  readMigrationBackup,
  targetArtifactsMatch,
  targetManagedDataExists,
  targetProfileStructureIsSafe
} from './user-data-migration-backup'
import {
  ensureSafeDirectory,
  manifestsMatch,
  migrationErrorCode,
  parseMarker,
  PROFILE_INDEX_FILE,
  PROFILES_DIRECTORY,
  readControlFile,
  serialize,
  writeAtomicFile,
  type MigrationHooks,
  type MigrationMarkerStatus
} from './user-data-migration-journal'

export type {
  MigrationHooks,
  MigrationMarkerStatus,
  MigrationStep
} from './user-data-migration-journal'

const MIGRATION_MARKER = '.hivecode-migration-state.json'
const MIGRATION_LOCK = '.hivecode-migration.lock'
const MIGRATION_BACKUP = '.hivecode-migration-backup-v1'
const MIGRATION_STAGING_PREFIX = '.hivecode-migration-staging'

export type MigrationResult =
  | { migrated: true; copiedCount: number; needsValidation: true }
  | {
      migrated: false
      reason:
        | 'already-migrated'
        | 'awaiting-validation'
        | 'awaiting-completion'
        | 'migration-in-progress'
        | 'no-orca-data'
        | 'existing-target-data'
        | 'migration-conflict'
        | 'unsafe-source'
        | 'error'
      errorCode?: string
    }

export type MigrationPaths = {
  hiveCodeUserData: string
  orcaUserData: string
}

function getPlatformAppDataBase(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir()
): string {
  if (platform === 'win32') {
    return process.env.APPDATA ?? join(homeDir, 'AppData', 'Roaming')
  }
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support')
  }
  return process.env.XDG_CONFIG_HOME ?? join(homeDir, '.config')
}

export function getLegacyOrcaUserDataPath(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir()
): string {
  const appName = platform === 'linux' ? 'orca' : 'Orca'
  return join(getPlatformAppDataBase(platform, homeDir), appName)
}

function getLegacyOrcaUserDataCandidates(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir()
): string[] {
  const base = getPlatformAppDataBase(platform, homeDir)
  const names = platform === 'linux' ? ['orca', 'Orca'] : ['Orca', 'orca']
  return [...new Set(names.map((name) => join(base, name)))]
}

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) {
    return true
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return migrationErrorCode(error) === 'EPERM'
  }
}

function acquireMigrationLock(target: string): number | null {
  const lock = join(target, MIGRATION_LOCK)
  for (let attempt = 0; attempt < 2; attempt++) {
    let openedDescriptor: number | null = null
    try {
      const descriptor = openSync(lock, 'wx', 0o600)
      openedDescriptor = descriptor
      writeFileSync(
        descriptor,
        serialize({ pid: process.pid, createdAt: new Date().toISOString() })
      )
      fsyncSync(descriptor)
      return descriptor
    } catch (error) {
      if (migrationErrorCode(error) !== 'EEXIST') {
        if (openedDescriptor !== null) {
          closeSync(openedDescriptor)
          rmSync(lock, { force: true })
        }
        throw error
      }
      try {
        const parsed = JSON.parse(readControlFile(lock)) as { pid?: unknown }
        if (
          typeof parsed.pid === 'number' &&
          Number.isInteger(parsed.pid) &&
          processIsAlive(parsed.pid)
        ) {
          return null
        }
        rmSync(lock, { force: true })
      } catch {
        throw new MigrationPolicyError('unsafe-source')
      }
    }
  }
  return null
}

function releaseMigrationLock(target: string, descriptor: number): void {
  try {
    closeSync(descriptor)
  } catch {
    // Best effort; a stale lock is reclaimed after this process exits.
  }
  try {
    rmSync(join(target, MIGRATION_LOCK), { force: true })
  } catch {
    // Best effort; do not turn a durable migration into a false failure.
  }
}

function findSource(paths?: Partial<MigrationPaths>): SanitizedMigrationSource | null {
  const candidates = paths?.orcaUserData ? [paths.orcaUserData] : getLegacyOrcaUserDataCandidates()
  for (const candidate of candidates) {
    const source = readSanitizedMigrationSource(candidate)
    if (source) {
      return source
    }
  }
  return null
}

function transitionMarker(
  target: string,
  from: MigrationMarkerStatus,
  to: MigrationMarkerStatus,
  timestampField: 'validatedAt' | 'completedAt',
  hooks?: MigrationHooks
): boolean {
  const markerPath = join(target, MIGRATION_MARKER)
  if (!existsSync(markerPath)) {
    return false
  }
  const marker = parseMarker(markerPath)
  if (marker.status === to || (to === 'completed' && marker.status === 'completed')) {
    return true
  }
  if (marker.status !== from) {
    return false
  }
  hooks?.beforeStep?.(to === 'validated' ? 'before-validation-commit' : 'before-completion-commit')
  writeAtomicFile(
    markerPath,
    serialize({ ...marker, status: to, [timestampField]: new Date().toISOString() })
  )
  return true
}

function targetMatchesMigrationBackup(target: string): boolean {
  try {
    const backup = readMigrationBackup(target, MIGRATION_BACKUP)
    return targetArtifactsMatch(target, backup.manifest) === 'match'
  } catch {
    return false
  }
}

export function validateUserDataMigration(target: string, hooks?: MigrationHooks): boolean {
  if (!targetMatchesMigrationBackup(target)) {
    return false
  }
  return transitionMarker(target, 'prepared', 'validated', 'validatedAt', hooks)
}

export function completeUserDataMigration(target: string, hooks?: MigrationHooks): boolean {
  if (!targetMatchesMigrationBackup(target)) {
    return false
  }
  return transitionMarker(target, 'validated', 'completed', 'completedAt', hooks)
}

export function migrateUserDataFromOrca(
  paths?: Partial<MigrationPaths>,
  hooks?: MigrationHooks
): MigrationResult {
  const target = resolve(paths?.hiveCodeUserData ?? join(getPlatformAppDataBase(), 'HiveCode'))
  try {
    ensureSafeDirectory(target)
  } catch (error) {
    return { migrated: false, reason: 'error', errorCode: migrationErrorCode(error) }
  }
  let lockDescriptor: number | null = null
  try {
    lockDescriptor = acquireMigrationLock(target)
    if (lockDescriptor === null) {
      return { migrated: false, reason: 'migration-in-progress' }
    }
    const markerPath = join(target, MIGRATION_MARKER)
    if (existsSync(markerPath)) {
      const marker = parseMarker(markerPath)
      if (marker.status === 'completed') {
        return { migrated: false, reason: 'already-migrated' }
      }
      if (marker.status === 'validated') {
        if (!targetProfileStructureIsSafe(target)) {
          return { migrated: false, reason: 'migration-conflict' }
        }
        return { migrated: false, reason: 'awaiting-completion' }
      }
      const backup = readMigrationBackup(target, MIGRATION_BACKUP)
      if (!manifestsMatch(marker, backup.manifest)) {
        return { migrated: false, reason: 'error', errorCode: 'marker_backup_mismatch' }
      }
      const state = targetArtifactsMatch(target, backup.manifest)
      if (state === 'conflict') {
        return { migrated: false, reason: 'migration-conflict' }
      }
      if (state === 'missing') {
        rmSync(join(target, PROFILE_INDEX_FILE), { force: true })
        rmSync(join(target, PROFILES_DIRECTORY), { recursive: true, force: true })
        commitMigrationBackup(target, MIGRATION_MARKER, MIGRATION_STAGING_PREFIX, backup, hooks)
      }
      return { migrated: false, reason: 'awaiting-validation' }
    }
    if (targetManagedDataExists(target)) {
      return { migrated: false, reason: 'existing-target-data' }
    }
    const backupPath = join(target, MIGRATION_BACKUP)
    if (!existsSync(backupPath)) {
      let source: SanitizedMigrationSource | null
      try {
        source = findSource(paths)
      } catch (error) {
        const code = migrationErrorCode(error)
        return {
          migrated: false,
          reason: code === 'unsafe-source' ? 'unsafe-source' : 'error',
          errorCode: code
        }
      }
      if (!source) {
        return { migrated: false, reason: 'no-orca-data' }
      }
      createMigrationBackup(target, MIGRATION_BACKUP, source, hooks)
    }
    const backup = readMigrationBackup(target, MIGRATION_BACKUP)
    const copiedCount = commitMigrationBackup(
      target,
      MIGRATION_MARKER,
      MIGRATION_STAGING_PREFIX,
      backup,
      hooks
    )
    return { migrated: true, copiedCount, needsValidation: true }
  } catch (error) {
    const code = migrationErrorCode(error)
    return {
      migrated: false,
      reason: existsSync(join(target, MIGRATION_MARKER)) ? 'migration-conflict' : 'error',
      errorCode: code
    }
  } finally {
    if (lockDescriptor !== null) {
      releaseMigrationLock(target, lockDescriptor)
    }
  }
}
