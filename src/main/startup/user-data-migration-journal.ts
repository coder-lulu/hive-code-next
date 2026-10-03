import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { MigrationPolicyError } from './user-data-migration-policy'

export const MIGRATION_VERSION = 1
export const PROFILE_INDEX_FILE = 'orca-profile-index.json'
export const DATA_FILE = 'orca-data.json'
export const ACTIVE_VIEW_FILE = 'active-view.json'
export const PROFILES_DIRECTORY = 'profiles'
export const BACKUP_MANIFEST = 'migration-manifest.json'
export const MAX_CONTROL_FILE_BYTES = 1024 * 1024
export const MAX_PROFILE_DATA_BYTES = 64 * 1024 * 1024
export const MAX_ACTIVE_VIEW_BYTES = 16 * 1024

export type MigrationMarkerStatus = 'prepared' | 'validated' | 'completed'

export type MigrationProfileDigest = {
  id: string
  dataSha256: string
  activeViewSha256?: string
}

export type MigrationManifest = {
  schemaVersion: number
  migrationId: string
  createdAt: string
  profileIndexSha256: string
  profiles: MigrationProfileDigest[]
}

export type MigrationMarker = MigrationManifest & {
  status: MigrationMarkerStatus
  validatedAt?: string
  completedAt?: string
}

export type MigrationStep =
  | 'before-backup-commit'
  | 'before-journal-commit'
  | 'before-profiles-commit'
  | 'before-index-commit'
  | 'before-post-commit-validation'
  | 'before-validation-commit'
  | 'before-completion-commit'

export type MigrationHooks = {
  beforeStep?: (step: MigrationStep) => void
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function migrationErrorCode(error: unknown): string {
  if (error instanceof MigrationPolicyError) {
    return error.code
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code.slice(0, 64)
  }
  return 'migration_failed'
}

export function ensureSafeDirectory(directory: string): void {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    return
  }
  assertExistingSafeDirectory(directory)
}

export function assertExistingSafeDirectory(directory: string): void {
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new MigrationPolicyError('unsafe-source')
  }
}

export function fsyncDirectory(directory: string): void {
  if (process.platform === 'win32') {
    return
  }
  const descriptor = openSync(directory, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

export function writeNewFile(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const descriptor = openSync(file, 'wx', 0o600)
  try {
    writeFileSync(descriptor, content, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

export function writeAtomicFile(file: string, content: string): void {
  const temporary = `${file}.tmp.${process.pid}.${randomUUID()}`
  try {
    writeNewFile(temporary, content)
    renameSync(temporary, file)
    fsyncDirectory(dirname(file))
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function readSafeFile(file: string, maxBytes: number): string {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new MigrationPolicyError('unsafe-source')
  }
  return readFileSync(file, 'utf8')
}

export function readControlFile(file: string): string {
  return readSafeFile(file, MAX_CONTROL_FILE_BYTES)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function parseManifest(value: unknown): MigrationManifest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== MIGRATION_VERSION ||
    !('migrationId' in value) ||
    typeof value.migrationId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(value.migrationId) ||
    !('createdAt' in value) ||
    typeof value.createdAt !== 'string' ||
    !('profileIndexSha256' in value) ||
    !isSha256(value.profileIndexSha256) ||
    !('profiles' in value) ||
    !Array.isArray(value.profiles) ||
    value.profiles.length === 0 ||
    value.profiles.length > 32
  ) {
    throw new MigrationPolicyError('invalid-source')
  }
  const profiles: MigrationProfileDigest[] = value.profiles.map((profile) => {
    if (
      typeof profile !== 'object' ||
      profile === null ||
      !('id' in profile) ||
      typeof profile.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(profile.id) ||
      !('dataSha256' in profile) ||
      !isSha256(profile.dataSha256) ||
      ('activeViewSha256' in profile &&
        profile.activeViewSha256 !== undefined &&
        !isSha256(profile.activeViewSha256))
    ) {
      throw new MigrationPolicyError('invalid-source')
    }
    return {
      id: profile.id,
      dataSha256: profile.dataSha256,
      ...('activeViewSha256' in profile && profile.activeViewSha256
        ? { activeViewSha256: profile.activeViewSha256 as string }
        : {})
    }
  })
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new MigrationPolicyError('invalid-source')
  }
  return {
    schemaVersion: MIGRATION_VERSION,
    migrationId: value.migrationId,
    createdAt: value.createdAt,
    profileIndexSha256: value.profileIndexSha256,
    profiles
  }
}

export function parseMarker(file: string): MigrationMarker {
  const raw = JSON.parse(readControlFile(file)) as unknown
  const manifest = parseManifest(raw)
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('status' in raw) ||
    !['prepared', 'validated', 'completed'].includes(String(raw.status))
  ) {
    throw new MigrationPolicyError('invalid-source')
  }
  return {
    ...manifest,
    status: raw.status as MigrationMarkerStatus,
    ...('validatedAt' in raw && typeof raw.validatedAt === 'string'
      ? { validatedAt: raw.validatedAt }
      : {}),
    ...('completedAt' in raw && typeof raw.completedAt === 'string'
      ? { completedAt: raw.completedAt }
      : {})
  }
}

export function manifestsMatch(left: MigrationManifest, right: MigrationManifest): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.migrationId === right.migrationId &&
    left.createdAt === right.createdAt &&
    left.profileIndexSha256 === right.profileIndexSha256 &&
    serialize(left.profiles) === serialize(right.profiles)
  )
}
