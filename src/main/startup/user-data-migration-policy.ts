import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { isTopLevelView } from '../../shared/top-level-view'
import {
  hasForbiddenMigrationKey,
  MigrationPolicyError,
  isJsonRecord,
  sanitizePersistedState
} from './user-data-migration-sanitizer'

export {
  hasForbiddenMigrationKey,
  MigrationPolicyError,
  sanitizePersistedState
} from './user-data-migration-sanitizer'

const PROFILE_INDEX_FILE = 'orca-profile-index.json'
const DATA_FILE = 'orca-data.json'
const ACTIVE_VIEW_FILE = 'active-view.json'
const MAX_INDEX_BYTES = 1024 * 1024
const MAX_DATA_BYTES = 64 * 1024 * 1024
const MAX_ACTIVE_VIEW_BYTES = 16 * 1024
const MAX_LOCAL_PROFILES = 32
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

type JsonRecord = Record<string, unknown>

type MigrationProfileSummary = Omit<SanitizedMigrationProfile, 'data' | 'activeView'> & {
  sourceKind: 'local' | 'cloud-linked'
}

export type SanitizedMigrationProfile = {
  id: string
  name: string
  avatar: { kind: 'initials'; initials: string; color: 'neutral' }
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  data: string
  activeView?: string
}

export type SanitizedMigrationSource = {
  activeProfileId: string
  profiles: SanitizedMigrationProfile[]
}

function assertSafeRoot(root: string): string {
  const stat = lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new MigrationPolicyError('unsafe-source')
  }
  return realpathSync(root)
}

function assertInsideRoot(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate)
  if (pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))) {
    return
  }
  throw new MigrationPolicyError('unsafe-source')
}

function readRegularFile(file: string, maxBytes: number, realRoot: string): string | null {
  if (!existsSync(file)) {
    return null
  }
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new MigrationPolicyError('unsafe-source')
  }
  if (stat.size > maxBytes) {
    throw new MigrationPolicyError('source-too-large')
  }
  assertInsideRoot(realRoot, realpathSync(file))
  return readFileSync(file, 'utf-8')
}

function readJsonCandidate(
  paths: readonly string[],
  maxBytes: number,
  realRoot: string,
  rejectForbiddenKeys = true
): unknown | null {
  let sawFile = false
  for (const file of paths) {
    const raw = readRegularFile(file, maxBytes, realRoot)
    if (raw === null) {
      continue
    }
    sawFile = true
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      // Try a rolling backup before giving up on this profile.
      continue
    }
    if (rejectForbiddenKeys && hasForbiddenMigrationKey(parsed)) {
      throw new MigrationPolicyError('unsafe-source')
    }
    return parsed
  }
  if (sawFile) {
    throw new MigrationPolicyError('invalid-source')
  }
  return null
}

function dataCandidates(dataFile: string): string[] {
  return [dataFile, ...Array.from({ length: 5 }, (_, index) => `${dataFile}.bak.${index}`)]
}

function sanitizeProfileSummary(value: JsonRecord): MigrationProfileSummary | null {
  if (
    typeof value.id !== 'string' ||
    !PROFILE_ID_PATTERN.test(value.id) ||
    (value.kind !== 'local' && value.kind !== 'cloud-linked')
  ) {
    return null
  }
  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim().slice(0, 80)
      : 'Personal'
  const avatar = isJsonRecord(value.avatar) ? value.avatar : {}
  const initials =
    typeof avatar.initials === 'string' && avatar.initials.trim()
      ? avatar.initials.trim().slice(0, 8)
      : name.slice(0, 1).toUpperCase() || 'P'
  const now = Date.now()
  return {
    id: value.id,
    name,
    avatar: { kind: 'initials', initials, color: 'neutral' },
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now,
    lastOpenedAt: typeof value.lastOpenedAt === 'number' ? value.lastOpenedAt : now,
    sourceKind: value.kind
  }
}

function readActiveView(profileDirectory: string, realRoot: string): string | undefined {
  const raw = readRegularFile(
    join(profileDirectory, ACTIVE_VIEW_FILE),
    MAX_ACTIVE_VIEW_BYTES,
    realRoot
  )
  if (raw === null) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
  if (hasForbiddenMigrationKey(parsed)) {
    throw new MigrationPolicyError('unsafe-source')
  }
  return isJsonRecord(parsed) && isTopLevelView(parsed.activeView)
    ? `${JSON.stringify({ activeView: parsed.activeView })}\n`
    : undefined
}

function serializeState(value: unknown, allowForbiddenSourceKeys = false): string {
  if (!allowForbiddenSourceKeys && hasForbiddenMigrationKey(value)) {
    throw new MigrationPolicyError('unsafe-source')
  }
  const sanitized = sanitizePersistedState(value)
  if (hasForbiddenMigrationKey(sanitized)) {
    throw new MigrationPolicyError('unsafe-source')
  }
  return `${JSON.stringify(sanitized, null, 2)}\n`
}

function readProfileIndex(root: string, realRoot: string): JsonRecord | null {
  const raw = readJsonCandidate(
    [join(root, PROFILE_INDEX_FILE), join(root, `${PROFILE_INDEX_FILE}.bak`)],
    MAX_INDEX_BYTES,
    realRoot
  )
  return isJsonRecord(raw) ? raw : null
}

function readIndexedProfiles(
  root: string,
  realRoot: string,
  index: JsonRecord
): SanitizedMigrationSource | null {
  if (!Array.isArray(index.profiles)) {
    return null
  }
  const summaries = index.profiles
    .slice(0, MAX_LOCAL_PROFILES)
    .filter(isJsonRecord)
    .map(sanitizeProfileSummary)
    .filter((summary): summary is MigrationProfileSummary => summary !== null)
  const localSummaries = summaries.filter((summary) => summary.sourceKind === 'local')
  // HiveCode has no legacy cloud identity, so project cloud state only for cloud-only installs.
  const selectedSummaries =
    localSummaries.length > 0
      ? localSummaries
      : summaries.filter((summary) => summary.sourceKind === 'cloud-linked')
  const profiles: SanitizedMigrationProfile[] = []
  const ids = new Set<string>()
  for (const summary of selectedSummaries) {
    if (ids.has(summary.id)) {
      continue
    }
    const { sourceKind, ...profileSummary } = summary
    const profileDirectory = join(root, 'profiles', summary.id)
    if (!existsSync(profileDirectory)) {
      continue
    }
    const profileStat = lstatSync(profileDirectory)
    if (!profileStat.isDirectory() || profileStat.isSymbolicLink()) {
      throw new MigrationPolicyError('unsafe-source')
    }
    const data = readJsonCandidate(
      dataCandidates(join(profileDirectory, DATA_FILE)),
      MAX_DATA_BYTES,
      realRoot,
      sourceKind === 'local'
    )
    if (data === null) {
      continue
    }
    ids.add(summary.id)
    profiles.push({
      ...profileSummary,
      data: serializeState(data, sourceKind === 'cloud-linked'),
      activeView: readActiveView(profileDirectory, realRoot)
    })
  }
  if (profiles.length === 0) {
    return null
  }
  const requestedActive = typeof index.activeProfileId === 'string' ? index.activeProfileId : ''
  return {
    activeProfileId: profiles.some((profile) => profile.id === requestedActive)
      ? requestedActive
      : profiles[0].id,
    profiles
  }
}

function readLegacyProfile(root: string, realRoot: string): SanitizedMigrationSource | null {
  const data = readJsonCandidate(dataCandidates(join(root, DATA_FILE)), MAX_DATA_BYTES, realRoot)
  if (data === null) {
    return null
  }
  const now = Date.now()
  return {
    activeProfileId: 'local-default',
    profiles: [
      {
        id: 'local-default',
        name: 'Personal',
        avatar: { kind: 'initials', initials: 'P', color: 'neutral' },
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        data: serializeState(data),
        activeView: readActiveView(root, realRoot)
      }
    ]
  }
}

export function readSanitizedMigrationSource(root: string): SanitizedMigrationSource | null {
  if (!existsSync(root)) {
    return null
  }
  const realRoot = assertSafeRoot(resolve(root))
  const index = readProfileIndex(root, realRoot)
  if (index) {
    const indexed = readIndexedProfiles(root, realRoot, index)
    if (indexed) {
      return indexed
    }
  }
  return readLegacyProfile(root, realRoot)
}
