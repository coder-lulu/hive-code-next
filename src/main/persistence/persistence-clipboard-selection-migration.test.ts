import {
  closeTestStores,
  testState,
  createStore,
  withPlatform,
  writeDataFile,
  readDataFile
} from './persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { tmpdir } from 'node:os'
import { profileStateDatabaseFile } from '../../shared/profile-state-storage-paths'

const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('../ssh/config/ssh-config-parser', () => ({
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

vi.mock('../telemetry/client', () => ({
  track: trackMock
}))

vi.mock('../telemetry/cohort-classifier', () => ({
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
  it('preserves an explicit floating terminal opt-out', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { floatingTerminalEnabled: false },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().floatingTerminalEnabled).toBe(false)
    expect(store.getSettings()).not.toHaveProperty('floatingTerminalDefaultedForAllUsers')
  })

  it('preserves a post-migration floating terminal opt-out', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        floatingTerminalEnabled: false,
        floatingTerminalDefaultedForAllUsers: true
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().floatingTerminalEnabled).toBe(false)
    expect(store.getSettings()).not.toHaveProperty('floatingTerminalDefaultedForAllUsers')
  })

  it('preserves explicit OSC 52 clipboard consent', async () => {
    // Migrate existing profiles too; changing the default alone affects only new installs (#10567).
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalAllowOsc52Clipboard: false },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().terminalAllowOsc52Clipboard).toBe(false)
    expect(store.getSettings()).not.toHaveProperty(
      'terminalAllowOsc52ClipboardDefaultedOnForAllUsers'
    )
  })

  it('preserves saved clipboard consent without inventing a migration marker', async () => {
    // Settle other migrations first, then rely on the debounced save to prove this migration dirties state.
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {},
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })
    const migrated = await createStore()
    migrated.flush()

    const settled = readDataFile() as { settings: Record<string, unknown> }
    settled.settings.terminalAllowOsc52Clipboard = false
    delete settled.settings.terminalAllowOsc52ClipboardDefaultedOnForAllUsers
    writeDataFile(settled)

    vi.useFakeTimers()
    try {
      const store = await createStore()
      vi.advanceTimersByTime(5000)
      await store.waitForPendingWrite()
    } finally {
      vi.useRealTimers()
    }

    const persisted = readDataFile() as {
      settings?: {
        terminalAllowOsc52Clipboard?: boolean
        terminalAllowOsc52ClipboardDefaultedOnForAllUsers?: boolean
      }
    }

    expect(persisted.settings?.terminalAllowOsc52Clipboard).toBe(false)
    expect(persisted.settings?.terminalAllowOsc52ClipboardDefaultedOnForAllUsers).toBeUndefined()
  })

  it('preserves a post-migration OSC 52 clipboard opt-out', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        terminalAllowOsc52Clipboard: false,
        terminalAllowOsc52ClipboardDefaultedOnForAllUsers: true
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().terminalAllowOsc52Clipboard).toBe(false)
    expect(store.getSettings()).not.toHaveProperty(
      'terminalAllowOsc52ClipboardDefaultedOnForAllUsers'
    )
  })

  it('does not arm a notice or override persisted clipboard consent', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalAllowOsc52Clipboard: false },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getUI().osc52ClipboardDefaultOnNoticePending).toBe(false)
  })

  it('leaves the OSC 52 notice disarmed for a profile with no persisted value', async () => {
    // Fresh profiles made no choice for the migration notice to explain.
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
    expect(store.getUI().osc52ClipboardDefaultOnNoticePending).toBe(false)
  })

  it('keeps the OSC 52 notice armed on disk until the renderer clears it', async () => {
    // Persist the pending notice before stamping migration complete so a crash cannot lose it.
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalAllowOsc52Clipboard: false },
      ui: { osc52ClipboardDefaultOnNoticePending: true },
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const armed = await createStore()
    armed.flush()
    const armedOnDisk = readDataFile() as {
      ui?: { osc52ClipboardDefaultOnNoticePending?: boolean }
    }
    expect(armedOnDisk.ui?.osc52ClipboardDefaultOnNoticePending).toBe(true)

    const reloaded = await createStore()
    expect(reloaded.getUI().osc52ClipboardDefaultOnNoticePending).toBe(true)

    reloaded.updateUI({ osc52ClipboardDefaultOnNoticePending: false })
    reloaded.flush()
    const cleared = await createStore()
    expect(cleared.getUI().osc52ClipboardDefaultOnNoticePending).toBe(false)
  })

  it('preserves an explicit Linux primary-selection opt-out', async () => {
    await withPlatform('linux', async () => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: { primarySelectionMiddleClickPaste: false },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })

      const store = await createStore()
      expect(store.getSettings().primarySelectionMiddleClickPaste).toBe(false)
      expect(store.getSettings()).not.toHaveProperty(
        'primarySelectionMiddleClickPasteDefaultedForLinux'
      )
      expect(store.getSettings()).not.toHaveProperty(
        'primarySelectionMiddleClickPasteDefaultedForTerminalDefaults'
      )
    })
  })

  it('preserves a post-migration Linux primary-selection opt-out', async () => {
    await withPlatform('linux', async () => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: {
          primarySelectionMiddleClickPaste: false,
          primarySelectionMiddleClickPasteDefaultedForLinux: true
        },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })

      const store = await createStore()
      expect(store.getSettings().primarySelectionMiddleClickPaste).toBe(false)
      expect(store.getSettings()).not.toHaveProperty(
        'primarySelectionMiddleClickPasteDefaultedForLinux'
      )
      expect(store.getSettings()).not.toHaveProperty(
        'primarySelectionMiddleClickPasteDefaultedForTerminalDefaults'
      )
    })
  })

  it('preserves an explicit macOS primary-selection opt-out', async () => {
    await withPlatform('darwin', async () => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: { primarySelectionMiddleClickPaste: false },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })

      const store = await createStore()
      expect(store.getSettings().primarySelectionMiddleClickPaste).toBe(false)
      expect(store.getSettings()).not.toHaveProperty(
        'primarySelectionMiddleClickPasteDefaultedForLinux'
      )
      expect(store.getSettings()).not.toHaveProperty(
        'primarySelectionMiddleClickPasteDefaultedForTerminalDefaults'
      )
    })
  })

  it('preserves a post-migration macOS primary-selection opt-out', async () => {
    await withPlatform('darwin', async () => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: {
          primarySelectionMiddleClickPaste: false,
          primarySelectionMiddleClickPasteDefaultedForTerminalDefaults: true
        },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })

      const store = await createStore()
      expect(store.getSettings().primarySelectionMiddleClickPaste).toBe(false)
      expect(store.getSettings()).not.toHaveProperty(
        'primarySelectionMiddleClickPasteDefaultedForTerminalDefaults'
      )
    })
  })

  it('keeps the primary-selection default disabled on Windows profiles', async () => {
    const physicalDatabaseFile = profileStateDatabaseFile(testState.dir)
    const originalNamespacePath = win32.toNamespacedPath
    const namespacePathSpy =
      process.platform === 'win32'
        ? undefined
        : vi.spyOn(win32, 'toNamespacedPath').mockImplementation(function (this: unknown, ...args) {
            return args[0] === physicalDatabaseFile
              ? physicalDatabaseFile
              : originalNamespacePath.apply(this, args)
          })
    try {
      await withPlatform('win32', async () => {
        writeDataFile({
          schemaVersion: 1,
          repos: [],
          worktreeMeta: {},
          settings: { primarySelectionMiddleClickPaste: false },
          ui: {},
          githubCache: { pr: {}, issue: {} },
          workspaceSession: {}
        })

        const store = await createStore()
        expect(store.getSettings().primarySelectionMiddleClickPaste).toBe(false)
        expect(store.getSettings()).not.toHaveProperty(
          'primarySelectionMiddleClickPasteDefaultedForTerminalDefaults'
        )
      })
    } finally {
      namespacePathSpy?.mockRestore()
    }
  })
})
