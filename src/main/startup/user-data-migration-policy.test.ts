import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hasForbiddenMigrationKey,
  readSanitizedMigrationSource,
  sanitizePersistedState,
  type MigrationPolicyError
} from './user-data-migration-policy'

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'user-data-policy-'))
  roots.push(root)
  return root
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(value), 'utf8')
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('user data migration policy', () => {
  it('keeps only allowlisted preferences and metadata', () => {
    const sanitized = sanitizePersistedState({
      schemaVersion: 9,
      repos: [
        {
          id: 'repo-1',
          path: '/workspace',
          displayName: 'Workspace',
          hookSettings: { scripts: { setup: 'export SECRET=value' } },
          gitRemoteIdentity: { remoteUrl: 'https://user:token@example.test/repo' }
        }
      ],
      settings: {
        theme: 'dark',
        workspaceDir: '/workspace',
        hostSettingOverrides: { local: { agentDefaultEnv: { API_KEY: 'secret' } } },
        httpProxyUrl: 'https://user:password@example.test',
        opencodeSessionCookie: 'cookie',
        pluginConsents: { untrusted: true },
        agentDefaultEnv: { API_KEY: 'secret' },
        codexManagedAccounts: [{ token: 'secret' }]
      },
      ui: {
        sidebarWidth: 320,
        browserKagiSessionLink: 'https://kagi.test/private-token',
        trustedOrcaHooks: { '/workspace': true }
      },
      workspaceSession: { authToken: 'secret' },
      sshTargets: [{ password: 'secret' }],
      githubCache: { token: 'secret' }
    })

    expect(sanitized).toMatchObject({
      schemaVersion: 9,
      repos: [{ id: 'repo-1', path: '/workspace', displayName: 'Workspace' }],
      settings: { theme: 'dark', workspaceDir: '/workspace' },
      ui: { sidebarWidth: 320 }
    })
    expect(sanitized).not.toHaveProperty('workspaceSession')
    expect(sanitized).not.toHaveProperty('sshTargets')
    expect(sanitized).not.toHaveProperty('githubCache')
    expect(sanitized.settings).not.toHaveProperty('hostSettingOverrides')
    expect(sanitized.settings).not.toHaveProperty('httpProxyUrl')
    expect(sanitized.settings).not.toHaveProperty('pluginConsents')
    expect(sanitized.repos).toEqual([
      { id: 'repo-1', path: '/workspace', displayName: 'Workspace' }
    ])
    expect(hasForbiddenMigrationKey(sanitized)).toBe(false)
  })

  it('detects sensitive key forms without matching benign prefixes', () => {
    for (const key of [
      'API_KEY',
      'githubApiKey',
      'authToken',
      'private_key',
      'passwordHash',
      'credentialId',
      'browserSession',
      'authenticationLatencyMs'
    ]) {
      expect(hasForbiddenMigrationKey({ [key]: 'secret' }), key).toBe(true)
    }
    for (const key of ['author', 'cacheTTL']) {
      expect(hasForbiddenMigrationKey({ [key]: 1 }), key).toBe(false)
    }
    // Why: fail-closed migration treats any standalone 'token' word
    // as sensitive, even in benign counters. Better to reject and
    // let the user re-configure than risk copying credential data.
    for (const key of ['tokenCount']) {
      expect(hasForbiddenMigrationKey({ [key]: 1 }), key).toBe(true)
    }
  })

  it('reads and sanitizes legacy state without modifying the source', () => {
    const source = makeRoot()
    const dataFile = join(source, 'orca-data.json')
    const original = JSON.stringify({ settings: { theme: 'light' } })
    writeFileSync(dataFile, original, 'utf8')

    const result = readSanitizedMigrationSource(source)

    expect(result?.activeProfileId).toBe('local-default')
    expect(result?.profiles).toHaveLength(1)
    expect(JSON.parse(result?.profiles[0]?.data ?? '{}')).toMatchObject({
      settings: { theme: 'light' }
    })
    expect(readFileSync(dataFile, 'utf8')).toBe(original)
  })

  it('fails closed on sensitive primary data instead of using a clean rolling backup', () => {
    const source = makeRoot()
    writeJson(join(source, 'orca-data.json'), {
      settings: { theme: 'light' },
      authToken: 'secret'
    })
    writeJson(join(source, 'orca-data.json.bak.0'), { settings: { theme: 'dark' } })

    expect(() => readSanitizedMigrationSource(source)).toThrowError(
      expect.objectContaining<Partial<MigrationPolicyError>>({ code: 'unsafe-source' })
    )
  })

  it('migrates only local indexed profiles and preserves a valid active view', () => {
    const source = makeRoot()
    writeJson(join(source, 'orca-profile-index.json'), {
      schemaVersion: 1,
      activeProfileId: 'cloud-profile',
      profiles: [
        { id: 'cloud-profile', kind: 'cloud-linked', name: 'Cloud' },
        {
          id: 'local-work',
          kind: 'local',
          name: 'Work',
          avatar: { initials: 'W' },
          createdAt: 1,
          updatedAt: 2,
          lastOpenedAt: 3
        }
      ]
    })
    writeJson(join(source, 'profiles', 'cloud-profile', 'orca-data.json'), {
      settings: { theme: 'cloud' }
    })
    writeJson(join(source, 'profiles', 'local-work', 'orca-data.json'), {
      settings: { theme: 'dark' }
    })
    writeJson(join(source, 'profiles', 'local-work', 'active-view.json'), {
      activeView: 'tasks'
    })

    const result = readSanitizedMigrationSource(source)

    expect(result?.activeProfileId).toBe('local-work')
    expect(result?.profiles.map((profile) => profile.id)).toEqual(['local-work'])
    expect(result?.profiles[0]?.activeView).toBe('{"activeView":"tasks"}\n')
  })

  it('projects a cloud-only profile into a local profile without copying sensitive state', () => {
    const source = makeRoot()
    writeJson(join(source, 'orca-profile-index.json'), {
      schemaVersion: 1,
      activeProfileId: 'cloud-profile',
      profiles: [{ id: 'cloud-profile', kind: 'cloud-linked', name: 'Cloud' }]
    })
    writeJson(join(source, 'profiles', 'cloud-profile', 'orca-data.json'), {
      settings: {
        theme: 'dark',
        opencodeSessionCookie: 'must-not-copy'
      },
      workspaceSession: { providerSession: 'must-not-copy' }
    })

    const result = readSanitizedMigrationSource(source)

    expect(result?.activeProfileId).toBe('cloud-profile')
    expect(result?.profiles.map((profile) => profile.id)).toEqual(['cloud-profile'])
    const sanitized = JSON.parse(result?.profiles[0]?.data ?? '{}')
    expect(sanitized).toMatchObject({ settings: { theme: 'dark' } })
    expect(sanitized).not.toHaveProperty('workspaceSession')
    expect(sanitized.settings).not.toHaveProperty('opencodeSessionCookie')
  })

  it('continues to reject sensitive state in local indexed profiles', () => {
    const source = makeRoot()
    writeJson(join(source, 'orca-profile-index.json'), {
      schemaVersion: 1,
      activeProfileId: 'local-work',
      profiles: [{ id: 'local-work', kind: 'local', name: 'Work' }]
    })
    writeJson(join(source, 'profiles', 'local-work', 'orca-data.json'), {
      settings: { theme: 'dark' },
      workspaceSession: { providerSession: 'must-not-copy' }
    })

    expect(() => readSanitizedMigrationSource(source)).toThrowError(
      expect.objectContaining<Partial<MigrationPolicyError>>({ code: 'unsafe-source' })
    )
  })

  it('fails closed on sensitive keys in profile metadata and active-view files', () => {
    for (const sensitiveFile of ['index', 'active-view'] as const) {
      const source = makeRoot()
      writeJson(join(source, 'orca-profile-index.json'), {
        schemaVersion: 1,
        activeProfileId: 'local-work',
        profiles: [{ id: 'local-work', kind: 'local', name: 'Work' }],
        ...(sensitiveFile === 'index' ? { API_KEY: 'secret' } : {})
      })
      writeJson(join(source, 'profiles', 'local-work', 'orca-data.json'), {
        settings: { theme: 'dark' }
      })
      writeJson(join(source, 'profiles', 'local-work', 'active-view.json'), {
        activeView: 'tasks',
        ...(sensitiveFile === 'active-view' ? { sessionToken: 'secret' } : {})
      })

      expect(() => readSanitizedMigrationSource(source), sensitiveFile).toThrowError(
        expect.objectContaining<Partial<MigrationPolicyError>>({ code: 'unsafe-source' })
      )
    }
  })

  it('uses a rolling data backup when the primary JSON is corrupt', () => {
    const source = makeRoot()
    writeFileSync(join(source, 'orca-data.json'), '{broken', 'utf8')
    writeJson(join(source, 'orca-data.json.bak.0'), { settings: { theme: 'light' } })

    const result = readSanitizedMigrationSource(source)

    expect(JSON.parse(result?.profiles[0]?.data ?? '{}')).toMatchObject({
      settings: { theme: 'light' }
    })
  })

  it('rejects corrupt state when no valid backup exists', () => {
    const source = makeRoot()
    writeFileSync(join(source, 'orca-data.json'), '{broken', 'utf8')

    expect(() => readSanitizedMigrationSource(source)).toThrowError(
      expect.objectContaining<Partial<MigrationPolicyError>>({ code: 'invalid-source' })
    )
  })

  it('rejects profile data larger than the migration limit', () => {
    const source = makeRoot()
    const dataFile = join(source, 'orca-data.json')
    writeFileSync(dataFile, '{}', 'utf8')
    truncateSync(dataFile, 64 * 1024 * 1024 + 1)

    expect(() => readSanitizedMigrationSource(source)).toThrowError(
      expect.objectContaining<Partial<MigrationPolicyError>>({ code: 'source-too-large' })
    )
  })

  it('rejects a profiles junction that escapes the source root', () => {
    const source = makeRoot()
    const outside = makeRoot()
    writeJson(join(source, 'orca-profile-index.json'), {
      schemaVersion: 1,
      activeProfileId: 'local-work',
      profiles: [{ id: 'local-work', kind: 'local', name: 'Work' }]
    })
    writeJson(join(outside, 'local-work', 'orca-data.json'), { settings: { theme: 'dark' } })
    symlinkSync(outside, join(source, 'profiles'), 'junction')

    expect(() => readSanitizedMigrationSource(source)).toThrowError(
      expect.objectContaining<Partial<MigrationPolicyError>>({ code: 'unsafe-source' })
    )
  })
})
