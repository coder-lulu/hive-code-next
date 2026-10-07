import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completeUserDataMigration,
  getLegacyOrcaUserDataPath,
  migrateUserDataFromOrca,
  validateUserDataMigration,
  type MigrationResult,
  type MigrationStep
} from './hivecode-user-data-migration'
import { resolveUserDataMigrationStartupAction } from './user-data-migration-startup-policy'

const MARKER = '.hivecode-migration-state.json'
const LOCK = '.hivecode-migration.lock'
const BACKUP = '.hivecode-migration-backup-v1'
const roots: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'product-migration-test-'))
  roots.push(directory)
  return directory
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(value), 'utf8')
}

function markerStatus(target: string): string {
  return (JSON.parse(readFileSync(join(target, MARKER), 'utf8')) as { status: string }).status
}

function throwAt(expected: MigrationStep): { beforeStep: (step: MigrationStep) => void } {
  return {
    beforeStep: (step) => {
      if (step === expected) {
        throw new Error(`injected-${step}`)
      }
    }
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('copy-only user data migration', () => {
  it('writes sanitized local profile data, backup, and a prepared marker', () => {
    const source = createTempDir()
    const target = createTempDir()
    const sourceData = JSON.stringify({
      repos: [
        {
          id: 'repo-1',
          path: '/workspace',
          displayName: 'Workspace',
          hookSettings: { scripts: { setup: 'npm install' } }
        }
      ],
      settings: { theme: 'dark' }
    })
    writeFileSync(join(source, 'orca-data.json'), sourceData, 'utf8')
    writeJson(join(source, 'orca-runtime.json'), { authToken: 'secret' })
    writeJson(join(source, 'credentials.json'), { token: 'secret' })
    mkdirSync(join(source, 'logs'))
    writeFileSync(join(source, 'logs', 'app.log'), 'secret', 'utf8')

    const result = migrateUserDataFromOrca({
      hiveCodeUserData: target,
      orcaUserData: source
    })

    expect(result).toMatchObject({ migrated: true, copiedCount: 2, needsValidation: true })
    const migrated = JSON.parse(
      readFileSync(join(target, 'profiles', 'local-default', 'orca-data.json'), 'utf8')
    ) as Record<string, unknown>
    expect(migrated).toMatchObject({
      repos: [{ id: 'repo-1', path: '/workspace', displayName: 'Workspace' }],
      settings: { theme: 'dark' }
    })
    expect(JSON.stringify(migrated)).not.toContain('secret')
    expect(existsSync(join(target, 'orca-runtime.json'))).toBe(false)
    expect(existsSync(join(target, 'credentials.json'))).toBe(false)
    expect(existsSync(join(target, 'logs'))).toBe(false)
    expect(existsSync(join(target, BACKUP, 'migration-manifest.json'))).toBe(true)
    expect(markerStatus(target)).toBe('prepared')
    expect(readFileSync(join(source, 'orca-data.json'), 'utf8')).toBe(sourceData)
    expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
      migrated: false,
      reason: 'awaiting-validation'
    })
  })

  it('fails closed when source data contains a forbidden sensitive key', () => {
    const source = createTempDir()
    const target = createTempDir()
    const sourceData = JSON.stringify({
      settings: { theme: 'light' },
      workspaceSession: { authToken: 'secret-value' }
    })
    writeFileSync(join(source, 'orca-data.json'), sourceData, 'utf8')

    const result = migrateUserDataFromOrca({
      hiveCodeUserData: target,
      orcaUserData: source
    })

    expect(result).toMatchObject({ migrated: false, reason: 'unsafe-source' })
    expect(readFileSync(join(source, 'orca-data.json'), 'utf8')).toBe(sourceData)
    expect(readdirSync(target)).toEqual([])
  })

  it('advances prepared to validated to completed only through explicit gates', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'light' } })
    expect(
      migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source }).migrated
    ).toBe(true)

    expect(validateUserDataMigration(target)).toBe(true)
    expect(markerStatus(target)).toBe('validated')
    expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
      migrated: false,
      reason: 'awaiting-completion'
    })
    expect(completeUserDataMigration(target)).toBe(true)
    expect(markerStatus(target)).toBe('completed')
    expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
      migrated: false,
      reason: 'already-migrated'
    })
  })

  it('does nothing when source data is absent', () => {
    const source = createTempDir()
    const target = createTempDir()

    expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
      migrated: false,
      reason: 'no-orca-data'
    })
    expect(existsSync(join(target, MARKER))).toBe(false)
    expect(existsSync(join(target, BACKUP))).toBe(false)
  })

  it('never overwrites existing target data, even while the file is open', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    const targetData = join(target, 'orca-data.json')
    writeFileSync(targetData, '{"existing":true}', 'utf8')
    const descriptor = openSync(targetData, 'r')
    try {
      expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
        migrated: false,
        reason: 'existing-target-data'
      })
      expect(readFileSync(targetData, 'utf8')).toBe('{"existing":true}')
    } finally {
      closeSync(descriptor)
    }
  })

  it('rolls back profiles, index, and marker when index commit fails', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })

    const result = migrateUserDataFromOrca(
      { hiveCodeUserData: target, orcaUserData: source },
      throwAt('before-index-commit')
    )

    expect(result).toMatchObject({ migrated: false, reason: 'error' })
    expect(existsSync(join(target, 'profiles'))).toBe(false)
    expect(existsSync(join(target, 'orca-profile-index.json'))).toBe(false)
    expect(existsSync(join(target, MARKER))).toBe(false)
    expect(existsSync(join(target, BACKUP))).toBe(true)
  })

  it('retries from the durable sanitized backup when source disappears', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    migrateUserDataFromOrca(
      { hiveCodeUserData: target, orcaUserData: source },
      throwAt('before-index-commit')
    )
    rmSync(source, { recursive: true, force: true })

    const result = migrateUserDataFromOrca({
      hiveCodeUserData: target,
      orcaUserData: source
    })

    expect(result.migrated).toBe(true)
    expect(existsSync(join(target, 'profiles', 'local-default', 'orca-data.json'))).toBe(true)
  })

  it('recovers a prepared migration interrupted before index commit', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })
    rmSync(join(target, 'orca-profile-index.json'))

    const result = migrateUserDataFromOrca({
      hiveCodeUserData: target,
      orcaUserData: source
    })

    expect(result).toEqual({ migrated: false, reason: 'awaiting-validation' })
    expect(existsSync(join(target, 'orca-profile-index.json'))).toBe(true)
    expect(markerStatus(target)).toBe('prepared')
  })

  it('refuses to overwrite changed target data during prepared recovery', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })
    const targetData = join(target, 'profiles', 'local-default', 'orca-data.json')
    writeFileSync(targetData, '{"userChange":true}', 'utf8')

    expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
      migrated: false,
      reason: 'migration-conflict'
    })
    expect(readFileSync(targetData, 'utf8')).toBe('{"userChange":true}')
  })

  it('preserves a changed surviving artifact when its paired target is missing', () => {
    for (const missing of ['index', 'profiles'] as const) {
      const source = createTempDir()
      const target = createTempDir()
      writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
      migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })
      const index = join(target, 'orca-profile-index.json')
      const data = join(target, 'profiles', 'local-default', 'orca-data.json')
      if (missing === 'index') {
        rmSync(index)
        writeFileSync(data, '{"userChange":true}', 'utf8')
      } else {
        rmSync(join(target, 'profiles'), { recursive: true })
        writeFileSync(index, '{"userChange":true}', 'utf8')
      }

      expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
        migrated: false,
        reason: 'migration-conflict'
      })
      expect(readFileSync(missing === 'index' ? data : index, 'utf8')).toBe('{"userChange":true}')
    }
  })

  it('treats unexpected managed artifacts as a recovery conflict', () => {
    const addUnexpectedArtifacts = [
      (target: string) => writeJson(join(target, 'orca-data.json'), { userChange: true }),
      (target: string) =>
        writeJson(join(target, 'profiles', 'unexpected', 'orca-data.json'), { userChange: true }),
      (target: string) =>
        writeJson(join(target, 'profiles', 'local-default', 'credentials.json'), {
          userChange: true
        })
    ]

    for (const addUnexpectedArtifact of addUnexpectedArtifacts) {
      const source = createTempDir()
      const target = createTempDir()
      writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
      migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })
      addUnexpectedArtifact(target)

      expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
        migrated: false,
        reason: 'migration-conflict'
      })
    }
  })

  it('fails before target commit when backup or journal creation fails', () => {
    for (const step of ['before-backup-commit', 'before-journal-commit'] as const) {
      const source = createTempDir()
      const target = createTempDir()
      writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })

      const result = migrateUserDataFromOrca(
        { hiveCodeUserData: target, orcaUserData: source },
        throwAt(step)
      )

      expect(result).toMatchObject({ migrated: false, reason: 'error' })
      expect(existsSync(join(target, 'profiles'))).toBe(false)
      expect(existsSync(join(target, 'orca-profile-index.json'))).toBe(false)
      expect(existsSync(join(target, MARKER))).toBe(false)
    }
  })

  it('does not delete a profiles directory created during the commit race', () => {
    const source = createTempDir()
    const target = createTempDir()
    const externalData = join(target, 'profiles', 'external', 'orca-data.json')
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })

    const result = migrateUserDataFromOrca(
      { hiveCodeUserData: target, orcaUserData: source },
      {
        beforeStep(step) {
          if (step === 'before-profiles-commit') {
            writeJson(externalData, { userChange: true })
          }
        }
      }
    )

    expect(result).toMatchObject({ migrated: false, reason: 'error' })
    expect(JSON.parse(readFileSync(externalData, 'utf8'))).toEqual({ userChange: true })
  })

  it('does not overwrite an index created during the commit race', () => {
    const source = createTempDir()
    const target = createTempDir()
    const targetIndex = join(target, 'orca-profile-index.json')
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })

    const result = migrateUserDataFromOrca(
      { hiveCodeUserData: target, orcaUserData: source },
      {
        beforeStep(step) {
          if (step === 'before-index-commit') {
            writeFileSync(targetIndex, 'external', 'utf8')
          }
        }
      }
    )

    expect(result).toMatchObject({ migrated: false, reason: 'error' })
    expect(readFileSync(targetIndex, 'utf8')).toBe('external')
    expect(existsSync(join(target, 'profiles'))).toBe(false)
  })

  it('rolls back its artifacts and preserves root data created after commit', () => {
    const source = createTempDir()
    const target = createTempDir()
    const externalData = join(target, 'orca-data.json')
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })

    const result = migrateUserDataFromOrca(
      { hiveCodeUserData: target, orcaUserData: source },
      {
        beforeStep(step) {
          if (step === 'before-post-commit-validation') {
            writeJson(externalData, { userChange: true })
          }
        }
      }
    )

    expect(result).toMatchObject({ migrated: false, reason: 'error' })
    expect(JSON.parse(readFileSync(externalData, 'utf8'))).toEqual({ userChange: true })
    expect(existsSync(join(target, 'profiles'))).toBe(false)
    expect(existsSync(join(target, 'orca-profile-index.json'))).toBe(false)
    expect(existsSync(join(target, MARKER))).toBe(false)
  })

  it('returns migration-in-progress while a live process owns the lock', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    writeJson(join(target, LOCK), { pid: process.pid })

    expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
      migrated: false,
      reason: 'migration-in-progress'
    })
    expect(existsSync(join(target, LOCK))).toBe(true)
  })

  it('does not classify an unsafe target lock as a recoverable source rejection', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    writeFileSync(join(target, LOCK), 'not-json', 'utf8')

    expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
      migrated: false,
      reason: 'error',
      errorCode: 'unsafe-source'
    })
    expect(readFileSync(join(target, LOCK), 'utf8')).toBe('not-json')
  })

  it('reclaims a stale lock and completes the prepared transaction', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    writeJson(join(target, LOCK), { pid: 2_147_483_647 })

    expect(
      migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source }).migrated
    ).toBe(true)
    expect(existsSync(join(target, LOCK))).toBe(false)
  })

  it('leaves marker state unchanged when validation or completion persistence fails', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })

    expect(() => validateUserDataMigration(target, throwAt('before-validation-commit'))).toThrow(
      'injected-before-validation-commit'
    )
    expect(markerStatus(target)).toBe('prepared')
    expect(validateUserDataMigration(target)).toBe(true)
    expect(() => completeUserDataMigration(target, throwAt('before-completion-commit'))).toThrow(
      'injected-before-completion-commit'
    )
    expect(markerStatus(target)).toBe('validated')
    expect(completeUserDataMigration(target)).toBe(true)
  })

  it('blocks completion when validated profile data is missing', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })
    expect(validateUserDataMigration(target)).toBe(true)
    rmSync(join(target, 'profiles', 'local-default', 'orca-data.json'))

    expect(migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source })).toEqual({
      migrated: false,
      reason: 'migration-conflict'
    })
    expect(markerStatus(target)).toBe('validated')
  })

  it('blocks completion when a non-active migrated profile is modified', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-profile-index.json'), {
      activeProfileId: 'profile-a',
      profiles: [
        { id: 'profile-a', kind: 'local', name: 'A' },
        { id: 'profile-b', kind: 'local', name: 'B' }
      ]
    })
    writeJson(join(source, 'profiles', 'profile-a', 'orca-data.json'), {
      settings: { theme: 'dark' }
    })
    writeJson(join(source, 'profiles', 'profile-b', 'orca-data.json'), {
      settings: { theme: 'light' }
    })

    expect(
      migrateUserDataFromOrca({ hiveCodeUserData: target, orcaUserData: source }).migrated
    ).toBe(true)
    expect(validateUserDataMigration(target)).toBe(true)
    writeJson(join(target, 'profiles', 'profile-b', 'orca-data.json'), {
      settings: { theme: 'corrupted' }
    })

    expect(completeUserDataMigration(target)).toBe(false)
    expect(markerStatus(target)).toBe('validated')
  })

  it('reports only a bounded error code for a corrupt backup', () => {
    const source = createTempDir()
    const target = createTempDir()
    writeJson(join(source, 'orca-data.json'), { settings: { theme: 'dark' } })
    migrateUserDataFromOrca(
      { hiveCodeUserData: target, orcaUserData: source },
      throwAt('before-index-commit')
    )
    writeFileSync(join(target, BACKUP, 'migration-manifest.json'), '{broken', 'utf8')

    const result = migrateUserDataFromOrca({
      hiveCodeUserData: target,
      orcaUserData: source
    })

    expect(result).toEqual({
      migrated: false,
      reason: 'error',
      errorCode: 'migration_failed'
    })
    expect(JSON.stringify(result)).not.toContain(target)
    expect(JSON.stringify(result)).not.toContain(source)
  })
})

describe('legacy user data paths', () => {
  it('uses the platform app-data convention and Linux lowercase app name', () => {
    vi.stubEnv('XDG_CONFIG_HOME', undefined)
    expect(getLegacyOrcaUserDataPath('darwin', '/Users/test')).toContain(
      join('Library', 'Application Support', 'Orca')
    )
    expect(getLegacyOrcaUserDataPath('linux', '/home/test')).toContain(join('.config', 'orca'))
    expect(getLegacyOrcaUserDataPath('win32', 'C:/Users/test')).toContain('Orca')
  })
})

describe('user data migration startup policy', () => {
  it('starts clean only when the untouched legacy source is rejected', () => {
    expect(
      resolveUserDataMigrationStartupAction({
        migrated: false,
        reason: 'unsafe-source'
      })
    ).toBe('start-clean')
  })

  it('keeps target migration failures startup-blocking', () => {
    const blockingResults: MigrationResult[] = [
      { migrated: false, reason: 'migration-in-progress' },
      { migrated: false, reason: 'migration-conflict' },
      { migrated: false, reason: 'error' }
    ]

    expect(blockingResults.map(resolveUserDataMigrationStartupAction)).toEqual([
      'block',
      'block',
      'block'
    ])
  })

  it('blocks unknown migration states by default', () => {
    expect(resolveUserDataMigrationStartupAction({ migrated: false, reason: 'future-state' })).toBe(
      'block'
    )
  })

  it('preserves validation, completion, and no-op startup states', () => {
    const results: MigrationResult[] = [
      { migrated: true, copiedCount: 2, needsValidation: true },
      { migrated: false, reason: 'awaiting-validation' },
      { migrated: false, reason: 'awaiting-completion' },
      { migrated: false, reason: 'already-migrated' },
      { migrated: false, reason: 'no-orca-data' },
      { migrated: false, reason: 'existing-target-data' }
    ]

    expect(results.map(resolveUserDataMigrationStartupAction)).toEqual([
      'validate-and-complete',
      'validate-and-complete',
      'complete',
      'continue',
      'continue',
      'continue'
    ])
  })
})

describe('main-process migration wiring', () => {
  it('validates after Store load and completes only after startup succeeds', () => {
    const read = (name: string): string =>
      readFileSync(join(import.meta.dirname, name), 'utf8').replaceAll('\r\n', '\n')
    const preflight = read('main-process-preflight.ts')
    const foundation = read('main-process-ready-foundation.ts')
    const launch = read('main-process-runtime-launch.ts')
    const migration = read('main-process-user-data-migration.ts')
    expect(preflight.indexOf('prepareUserDataMigration()')).toBeGreaterThan(
      preflight.indexOf('if (!hasLock) {')
    )
    expect(foundation.indexOf('validatePreparedUserDataMigration()')).toBeGreaterThan(
      foundation.indexOf('const store = new Store(')
    )
    expect(launch).toMatch(
      /await printServeReady\(serveOptions\)\s*completePendingUserDataMigration\(\)/
    )
    expect(launch).toMatch(
      /await launchDesktopMode\([^\n]+\)\s*completePendingUserDataMigration\(\)/
    )
    expect(migration).toContain('hiveCodeUserData: getCanonicalUserDataPath()')
    expect(migration).toContain('validateUserDataMigration(getCanonicalUserDataPath())')
    expect(migration).toContain('resolveUserDataMigrationStartupAction(migrationResult)')
    expect(migration).toContain("migrationAction === 'start-clean'")
    expect(migration).toContain('Data from an older app version could not be imported safely.')
    expect(migration).toContain('Your existing data was not changed.')
  })
})
