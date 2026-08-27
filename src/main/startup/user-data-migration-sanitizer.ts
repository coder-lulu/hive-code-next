import {
  SAFE_FOLDER_WORKSPACE_KEYS,
  SAFE_PROJECT_GROUP_KEYS,
  SAFE_PROJECT_HOST_SETUP_KEYS,
  SAFE_PROJECT_KEYS,
  SAFE_REPO_KEYS,
  SAFE_SPARSE_PRESET_KEYS,
  SAFE_WORKTREE_META_KEYS
} from './user-data-migration-metadata-allowlist'
import { SAFE_SETTINGS_KEYS, SAFE_UI_KEYS } from './user-data-migration-preference-allowlist'

const FORBIDDEN_KEY_WORDS = new Set([
  'auth',
  'authentication',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'oauth',
  'passwd',
  'password',
  'passwords',
  'secret',
  'secrets',
  'session',
  'token',
  'tokens'
])
const FORBIDDEN_KEY_TAILS = new Set([
  'accesskey',
  'accesskeys',
  'apikey',
  'apikeys',
  'encryptionkey',
  'encryptionkeys',
  'privatekey',
  'privatekeys',
  'refreshkey',
  'refreshkeys',
  'signingkey',
  'signingkeys'
])

// Why: credential-shaped values that indicate authentication material
// even when the key name does not match a forbidden pattern.
const JWT_LIKE_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const URL_USERINFO_RE = /[a-z][a-z0-9+.-]*:\/\/[^/@]+@/i
const PEM_MARKER = '-----BEGIN'
const BEARER_PREFIX_LOWER = 'bearer '

type JsonRecord = Record<string, unknown>

export class MigrationPolicyError extends Error {
  constructor(readonly code: 'unsafe-source' | 'source-too-large' | 'invalid-source') {
    super(code)
  }
}

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Why: even when a key passes name-based exclusion, its string value can carry
 * credential-shaped data (URL userinfo, JWT/bearer tokens, PEM private keys).
 * A fail-closed migration must reject such values outright, not copy them.
 */
function containsCredentialMaterial(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  if (URL_USERINFO_RE.test(trimmed)) {
    return true
  }
  if (JWT_LIKE_RE.test(trimmed)) {
    return true
  }
  if (trimmed.includes(PEM_MARKER)) {
    return true
  }
  if (trimmed.toLowerCase().startsWith(BEARER_PREFIX_LOWER)) {
    return true
  }
  return false
}

function isForbiddenMigrationKeyName(key: string): boolean {
  const words = key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  if (words.some((word) => FORBIDDEN_KEY_WORDS.has(word))) {
    return true
  }
  if (words.at(-1) === 'token') {
    return true
  }
  return FORBIDDEN_KEY_TAILS.has(words.slice(-2).join(''))
}

function cloneAllowedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneAllowedValue)
  }
  if (!isJsonRecord(value)) {
    // Why: string leaves that contain credential-shaped material must
    // abort the migration, not silently strip or copy.
    if (typeof value === 'string' && containsCredentialMaterial(value)) {
      throw new MigrationPolicyError('unsafe-source')
    }
    return value
  }
  const output: JsonRecord = {}
  for (const [key, nested] of Object.entries(value)) {
    if (
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor' ||
      isForbiddenMigrationKeyName(key)
    ) {
      continue
    }
    output[key] = cloneAllowedValue(nested)
  }
  return output
}

function pickRecord(value: unknown, keys: readonly string[]): JsonRecord {
  if (!isJsonRecord(value)) {
    return {}
  }
  const output: JsonRecord = {}
  for (const key of keys) {
    if (Object.hasOwn(value, key)) {
      output[key] = cloneAllowedValue(value[key])
    }
  }
  return output
}

function pickRecordArray(value: unknown, keys: readonly string[]): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(isJsonRecord).map((entry) => pickRecord(entry, keys))
    : []
}

function pickRecordMap(value: unknown, keys: readonly string[]): JsonRecord {
  if (!isJsonRecord(value)) {
    return {}
  }
  const output: JsonRecord = {}
  for (const [key, entry] of Object.entries(value)) {
    if (
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor' ||
      !isJsonRecord(entry)
    ) {
      continue
    }
    output[key] = pickRecord(entry, keys)
  }
  return output
}

function sanitizeSparsePresets(value: unknown): JsonRecord {
  if (!isJsonRecord(value)) {
    return {}
  }
  const output: JsonRecord = {}
  for (const [repoId, presets] of Object.entries(value)) {
    if (repoId === '__proto__' || repoId === 'prototype' || repoId === 'constructor') {
      continue
    }
    output[repoId] = pickRecordArray(presets, SAFE_SPARSE_PRESET_KEYS)
  }
  return output
}

export function sanitizePersistedState(value: unknown): JsonRecord {
  if (!isJsonRecord(value)) {
    throw new MigrationPolicyError('invalid-source')
  }
  const output: JsonRecord = {}
  if (Number.isSafeInteger(value.schemaVersion) && (value.schemaVersion as number) >= 0) {
    output.schemaVersion = value.schemaVersion
  }
  output.repos = pickRecordArray(value.repos, SAFE_REPO_KEYS)
  output.projects = pickRecordArray(value.projects, SAFE_PROJECT_KEYS)
  output.projectHostSetups = pickRecordArray(value.projectHostSetups, SAFE_PROJECT_HOST_SETUP_KEYS)
  output.projectGroups = pickRecordArray(value.projectGroups, SAFE_PROJECT_GROUP_KEYS)
  output.folderWorkspaces = pickRecordArray(value.folderWorkspaces, SAFE_FOLDER_WORKSPACE_KEYS)
  output.sparsePresetsByRepo = sanitizeSparsePresets(value.sparsePresetsByRepo)
  output.worktreeMeta = pickRecordMap(value.worktreeMeta, SAFE_WORKTREE_META_KEYS)
  output.settings = pickRecord(value.settings, SAFE_SETTINGS_KEYS)
  output.ui = pickRecord(value.ui, SAFE_UI_KEYS)
  return output
}

export function hasForbiddenMigrationKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenMigrationKey)
  }
  if (!isJsonRecord(value)) {
    return false
  }
  return Object.entries(value).some(
    ([key, nested]) => isForbiddenMigrationKeyName(key) || hasForbiddenMigrationKey(nested)
  )
}
