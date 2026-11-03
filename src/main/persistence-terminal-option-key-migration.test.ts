import {
  closeTestStores,
  testState,
  createStore,
  withPlatform,
  writeDataFile,
  readDataFile
} from './persistence/persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { tmpdir } from 'node:os'
import type { PersistedState } from '../shared/persisted-state-types'
import { profileStateDatabaseFile } from '../shared/profile-state-storage-paths'

// Stub the ~/.ssh/config parser so the SSH-import test drives the real Store with deterministic hosts, not the operator's actual ~/.ssh/config.
const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))
const { trackMock, getCohortAtEmitMock } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))

vi.mock('./telemetry/client', () => ({
  track: trackMock
}))

vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

async function withProfileDatabasePlatform<T>(
  platform: NodeJS.Platform,
  fn: () => Promise<T>
): Promise<T> {
  if (platform !== 'win32' || process.platform === 'win32') {
    return withPlatform(platform, fn)
  }
  const physicalDatabaseFile = profileStateDatabaseFile(testState.dir)
  const originalNamespacePath = win32.toNamespacedPath
  const namespacePathSpy = vi.spyOn(win32, 'toNamespacedPath').mockImplementation(function (
    this: unknown,
    ...args
  ) {
    return args[0] === physicalDatabaseFile
      ? physicalDatabaseFile
      : originalNamespacePath.apply(this, args)
  })
  try {
    return await withPlatform(platform, fn)
  } finally {
    namespacePathSpy.mockRestore()
  }
}

describe('Store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })
  // ── terminalMacOptionAsAlt migration (issue #903) ───────────────────

  it('preserves explicit both Option keys without a migration marker', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalMacOptionAsAlt: 'true' },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalMacOptionAsAlt).toBe('true')
  })

  it('defaults right-click paste for each platform when unset', async () => {
    for (const [platform, expected] of [
      ['win32', true],
      ['darwin', false],
      ['linux', false]
    ] as const) {
      await withProfileDatabasePlatform(platform, async () => {
        writeDataFile({
          schemaVersion: 1,
          repos: [],
          worktreeMeta: {},
          settings: {},
          ui: {},
          githubCache: { pr: {}, issue: {} },
          workspaceSession: {}
        })
        const store = await createStore()
        expect(store.getSettings().terminalRightClickToPaste).toBe(expected)
      })
    }
  })

  it('preserves an explicit Windows right-click paste opt-out across load', async () => {
    await withProfileDatabasePlatform('win32', async () => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: { terminalRightClickToPaste: false },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })
      const store = await createStore()
      expect(store.getSettings().terminalRightClickToPaste).toBe(false)
    })
  })

  it('preserves right-click paste choices across load', async () => {
    await withPlatform('darwin', async () => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: {
          terminalRightClickToPaste: true
        },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })
      const store = await createStore()
      expect(store.getSettings().terminalRightClickToPaste).toBe(true)
    })
  })

  it('defaults the terminal cursor to block when unset', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalCursorStyle).toBe('block')
  })

  it('preserves terminal cursor choices across load', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalCursorStyle: 'bar' },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalCursorStyle).toBe('bar')
  })

  it('replaces an invalid persisted terminal cursor choice across load', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalCursorStyle: 'beam' },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalCursorStyle).toBe('block')
    store.flush()
    expect((readDataFile() as PersistedState).settings.terminalCursorStyle).toBe('block')
  })

  it('preserves explicit "false" terminalMacOptionAsAlt across load', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalMacOptionAsAlt: 'false' },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalMacOptionAsAlt).toBe('false')
  })

  it.each(['left', 'right'] as const)(
    'preserves explicit %s terminalMacOptionAsAlt across save and reload',
    async (choice) => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: { terminalMacOptionAsAlt: choice },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })
      const store = await createStore()
      expect(store.getSettings().terminalMacOptionAsAlt).toBe(choice)
      store.flush()
      await closeTestStores()
      expect((await createStore()).getSettings().terminalMacOptionAsAlt).toBe(choice)
      expect(readDataFile()).not.toHaveProperty('settings.terminalMacOptionAsAltMigrated')
    }
  )

  it('respects current settings with explicit "true"', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalMacOptionAsAlt: 'true' },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalMacOptionAsAlt).toBe('true')
  })

  it('fresh install defaults terminalMacOptionAsAlt to "auto"', async () => {
    const store = await createStore()
    expect(store.getSettings().terminalMacOptionAsAlt).toBe('auto')
  })

  it('missing terminalMacOptionAsAlt in persisted file defaults to "auto"', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalMacOptionAsAlt).toBe('auto')
  })

  it('persists the current compact worktree cards choice', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { compactWorktreeCards: true },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings().compactWorktreeCards).toBe(true)
    store.flush()
    expect((readDataFile() as PersistedState).settings.compactWorktreeCards).toBe(true)
  })
})
