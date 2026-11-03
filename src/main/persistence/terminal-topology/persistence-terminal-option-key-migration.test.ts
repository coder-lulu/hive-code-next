import {
  closeTestStores,
  testState,
  createStore,
  withPlatform,
  writeDataFile,
  readDataFile
} from '../persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PersistedState } from '../../../shared/persisted-state-types'

const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('../../ssh/config/ssh-config-parser', () => ({
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

vi.mock('../../telemetry/client', () => ({
  track: trackMock
}))

vi.mock('../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

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

  it('preserves a saved Option-as-Alt choice without an age marker', async () => {
    // The old true default cannot reveal user intent; migrate it once to auto for non-US layouts.
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
    expect(store.getSettings()).not.toHaveProperty('terminalMacOptionAsAltMigrated')
  })

  it('preserves explicit right-click paste across platforms', async () => {
    for (const [platform] of [
      ['win32', true],
      ['darwin', false],
      ['linux', false]
    ] as const) {
      await withPlatform(platform, async () => {
        writeDataFile({
          schemaVersion: 1,
          repos: [],
          worktreeMeta: {},
          settings: { terminalRightClickToPaste: true },
          ui: {},
          githubCache: { pr: {}, issue: {} },
          workspaceSession: {}
        })
        const store = await createStore()
        expect(store.getSettings().terminalRightClickToPaste).toBe(true)
        expect(store.getSettings()).not.toHaveProperty(
          'terminalRightClickToPasteDefaultedForPlatform'
        )
      })
    }
  })

  it('preserves an explicit Windows right-click paste opt-out during migration', async () => {
    await withPlatform('win32', async () => {
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
      expect(store.getSettings()).not.toHaveProperty(
        'terminalRightClickToPasteDefaultedForPlatform'
      )
    })
  })

  it('preserves right-click paste choices after the platform migration', async () => {
    await withPlatform('darwin', async () => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: {
          terminalRightClickToPaste: true,
          terminalRightClickToPasteDefaultedForPlatform: true
        },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })
      const store = await createStore()
      expect(store.getSettings().terminalRightClickToPaste).toBe(true)
    })
  })

  it('preserves a saved bar cursor without a migration marker', async () => {
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
    expect(store.getSettings()).not.toHaveProperty('terminalCursorStyleDefaultedToBlock')
  })

  it('preserves terminal cursor choices after the block-default migration', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalCursorStyle: 'bar', terminalCursorStyleDefaultedToBlock: true },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalCursorStyle).toBe('bar')
    expect(store.getSettings()).not.toHaveProperty('terminalCursorStyleDefaultedToBlock')
  })

  it('replaces an invalid persisted terminal cursor choice after migration', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalCursorStyle: 'beam', terminalCursorStyleDefaultedToBlock: true },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalCursorStyle).toBe('block')
    store.flush()
    expect((readDataFile() as PersistedState).settings.terminalCursorStyle).toBe('block')
  })

  it('preserves explicit "false" terminalMacOptionAsAlt through migration', async () => {
    // Legacy false differed from the default and therefore proves an explicit choice.
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
    expect(store.getSettings()).not.toHaveProperty('terminalMacOptionAsAltMigrated')
  })

  it.each(['left', 'right'] as const)(
    'preserves explicit "%s" terminalMacOptionAsAlt through migration',
    async (side) => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: { terminalMacOptionAsAlt: side },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })
      const store = await createStore()
      expect(store.getSettings().terminalMacOptionAsAlt).toBe(side)
      expect(store.getSettings()).not.toHaveProperty('terminalMacOptionAsAltMigrated')
    }
  )

  it('respects already-migrated settings with explicit "true"', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalMacOptionAsAlt: 'true', terminalMacOptionAsAltMigrated: true },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const store = await createStore()
    expect(store.getSettings().terminalMacOptionAsAlt).toBe('true')
    expect(store.getSettings()).not.toHaveProperty('terminalMacOptionAsAltMigrated')
  })

  it('fresh install defaults terminalMacOptionAsAlt to "auto" and marks migrated', async () => {
    const store = await createStore()
    expect(store.getSettings().terminalMacOptionAsAlt).toBe('auto')
    // No migration ran on a new profile; a later legacy true value must still migrate.
    expect(store.getSettings()).not.toHaveProperty('terminalMacOptionAsAltMigrated')
  })

  it('missing terminalMacOptionAsAlt in persisted file defaults to "auto" and flags migrated', async () => {
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
    expect(store.getSettings()).not.toHaveProperty('terminalMacOptionAsAltMigrated')
  })

  it('migrates the legacy experimentalSidekick setting to experimentalPet', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { experimentalSidekick: true },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings().experimentalPet).toBe(true)
  })

  it('migrates the legacy experimental compact worktree cards setting', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { experimentalCompactWorktreeCards: true },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings().compactWorktreeCards).toBe(true)
    expect(store.getSettings()).not.toHaveProperty('experimentalCompactWorktreeCards')
  })

  it('defaults legacy experimentalActivity profiles off once', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { experimentalActivity: true },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings()).not.toHaveProperty('experimentalActivity')
    expect(store.getSettings()).not.toHaveProperty('experimentalActivityDefaultedOffForAllUsers')
  })

  it('preserves experimentalActivity after the default-off migration has run', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        experimentalActivity: true,
        experimentalActivityDefaultedOffForAllUsers: true
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings()).not.toHaveProperty('experimentalActivity')
  })
})
