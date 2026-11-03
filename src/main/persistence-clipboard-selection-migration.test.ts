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
  it('defaults unset floating terminal to enabled', async () => {
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
    expect(store.getSettings().floatingTerminalEnabled).toBe(true)
  })

  it('preserves a current floating terminal opt-out', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        floatingTerminalEnabled: false
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().floatingTerminalEnabled).toBe(false)
  })

  it('defaults unset OSC 52 clipboard to enabled', async () => {
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
    expect(store.getSettings().terminalAllowOsc52Clipboard).toBe(true)
  })

  it('persists an explicit OSC 52 opt-out through the debounced settings write', async () => {
    const store = await createStore()
    store.flush()
    vi.useFakeTimers()
    try {
      store.updateSettings({ terminalAllowOsc52Clipboard: false })
      vi.advanceTimersByTime(5000)
      await store.waitForPendingWrite()
    } finally {
      vi.useRealTimers()
    }
    expect(readDataFile()).toHaveProperty('settings.terminalAllowOsc52Clipboard', false)
    await closeTestStores()
    expect((await createStore()).getSettings().terminalAllowOsc52Clipboard).toBe(false)
  })

  it('preserves a current OSC 52 clipboard opt-out', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        terminalAllowOsc52Clipboard: false
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().terminalAllowOsc52Clipboard).toBe(false)
  })

  it('preserves explicit OSC 52 opt-out without arming a migration notice', async () => {
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

  it('defaults unset Linux primary-selection to enabled', async () => {
    await withPlatform('linux', async () => {
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
      expect(store.getSettings().primarySelectionMiddleClickPaste).toBe(true)
    })
  })

  it('preserves a current Linux primary-selection opt-out', async () => {
    await withPlatform('linux', async () => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: {
          primarySelectionMiddleClickPaste: false
        },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })

      const store = await createStore()
      expect(store.getSettings().primarySelectionMiddleClickPaste).toBe(false)
    })
  })

  it('defaults unset macOS primary-selection to enabled', async () => {
    await withPlatform('darwin', async () => {
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
      expect(store.getSettings().primarySelectionMiddleClickPaste).toBe(true)
    })
  })

  it('preserves a current macOS primary-selection opt-out', async () => {
    await withPlatform('darwin', async () => {
      writeDataFile({
        schemaVersion: 1,
        repos: [],
        worktreeMeta: {},
        settings: {
          primarySelectionMiddleClickPaste: false
        },
        ui: {},
        githubCache: { pr: {}, issue: {} },
        workspaceSession: {}
      })

      const store = await createStore()
      expect(store.getSettings().primarySelectionMiddleClickPaste).toBe(false)
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
      })
    } finally {
      namespacePathSpy?.mockRestore()
    }
  })
})
