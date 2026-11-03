import {
  closeTestStores,
  testState,
  createStore,
  makeRepo,
  makeWorktreeLineage,
  makeWorkspaceLineage
} from './persistence/persistence-test-harness'
import { makeTerminalTab } from './persistence/persistence-session-fixtures'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { WorkspaceSessionState } from '../shared/workspace-session-state-types'
import { getDefaultWorkspaceSession } from '../shared/constants'
import { folderWorkspaceKey, worktreeWorkspaceKey } from '../shared/workspace-scope'
import { hostWorktreeTarget } from '../shared/worktree/host-qualified-identity'

// Stub the ~/.ssh/config parser so the SSH-import test drives the real Store with deterministic hosts, not the operator's actual ~/.ssh/config.
const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('./ssh/config/ssh-config-parser', () => ({
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

describe('current Store consent persistence', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'hive-current-consent-'))
  })
  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it.each([true, false, null])(
    'retains explicit consent %s and identity through SQLite reload',
    async (optedIn) => {
      const store = await createStore()
      store.updateSettings({ theme: 'dark', telemetry: { optedIn, installId: 'recorded-install' } })
      store.flush()
      const reloaded = await createStore()
      expect(reloaded.getSettings().theme).toBe('dark')
      expect(reloaded.getSettings().telemetry).toEqual({ optedIn, installId: 'recorded-install' })
      expect(reloaded.getSettings()).not.toHaveProperty('tabSwitchKeybindingSeed')
    }
  )
})

describe('Store.migrateWorktreeIdentity', () => {
  const OLD = 'repo1::/ws/cunner'
  const NEW = 'repo1::/ws/worktree-creation-spinner'
  const OLD_WORKSPACE_KEY = worktreeWorkspaceKey(OLD)
  const NEW_WORKSPACE_KEY = worktreeWorkspaceKey(NEW)

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('moves meta, lineage, tabs, active pointers, and records the prior id', async () => {
    const store = await createStore()
    store.setWorktreeMeta(hostWorktreeTarget({ id: OLD, hostId: 'local' }), {
      displayName: 'Cunner',
      linkedIssue: 42
    })
    store.setWorktreeLineage(
      hostWorktreeTarget({ id: OLD, hostId: 'local' }),
      makeWorktreeLineage({ worktreeId: OLD })
    )
    store.setWorkspaceLineage(
      makeWorkspaceLineage({
        childWorkspaceKey: OLD_WORKSPACE_KEY,
        parentWorkspaceKey: folderWorkspaceKey('folder-parent')
      })
    )
    store.setWorkspaceLineage(
      makeWorkspaceLineage({
        childWorkspaceKey: worktreeWorkspaceKey('repo1::/ws/child'),
        parentWorkspaceKey: OLD_WORKSPACE_KEY
      })
    )
    store.setWorkspaceSession({
      activeRepoId: 'repo1',
      activeWorkspaceKey: OLD_WORKSPACE_KEY,
      activeWorktreeId: OLD,
      activeTabId: 'tab1',
      tabsByWorktree: { [OLD]: [makeTerminalTab({ id: 'tab1', worktreeId: OLD })] },
      activeWorktreeIdsOnShutdown: [OLD],
      openFilesByWorktree: {
        [OLD]: [
          { filePath: '/ws/cunner/a.ts', relativePath: 'a.ts', worktreeId: OLD, language: 'ts' }
        ]
      },
      activeFileIdByWorktree: { [OLD]: '/ws/cunner/a.ts' },
      browserTabsByWorktree: {
        [OLD]: [
          {
            id: 'browser1',
            worktreeId: OLD,
            title: 'Browser',
            url: 'about:blank',
            docLocation: {
              kind: 'workspace-doc',
              worktreeId: OLD,
              filePath: '/ws/cunner/docs/report.html'
            }
          }
        ]
      },
      browserPagesByWorkspace: {
        browser1: [
          {
            id: 'page1',
            workspaceId: 'browser1',
            worktreeId: OLD,
            docLocation: {
              kind: 'workspace-doc',
              worktreeId: OLD,
              filePath: '/ws/cunner/docs/report.html'
            }
          }
        ]
      },
      activeBrowserTabIdByWorktree: { [OLD]: 'browser1' },
      activeTabTypeByWorktree: { [OLD]: 'browser' },
      activeTabIdByWorktree: { [OLD]: 'tab1' },
      unifiedTabs: { [OLD]: [{ id: 'unified1', worktreeId: OLD }] },
      tabGroups: {
        [OLD]: [{ id: 'group1', worktreeId: OLD, activeTabId: 'unified1', tabOrder: ['unified1'] }]
      },
      tabGroupLayouts: { [OLD]: { type: 'leaf', groupId: 'group1' } },
      activeGroupIdByWorktree: { [OLD]: 'group1' },
      lastVisitedAtByWorktreeId: { [OLD]: 123 },
      defaultTerminalTabsAppliedByWorktreeId: { [OLD]: true },
      terminalTopologyRevisionByRepoId: { repo1: 4 },
      sleepingAgentSessionsByPaneKey: {
        'tab1:leaf': {
          paneKey: 'tab1:leaf',
          tabId: 'tab1',
          worktreeId: OLD,
          agent: 'codex',
          providerSession: { key: 'session_id', id: 'session-1' },
          prompt: 'Do work',
          state: 'done',
          capturedAt: 1,
          updatedAt: 1
        }
      },
      terminalLayoutsByTabId: {}
    } as unknown as WorkspaceSessionState)
    store.setWorkspaceSession(
      {
        ...getDefaultWorkspaceSession(),
        activeRepoId: 'repo1',
        activeWorkspaceKey: OLD_WORKSPACE_KEY,
        activeWorktreeId: OLD,
        tabsByWorktree: { [OLD]: [makeTerminalTab({ id: 'host-tab', worktreeId: OLD })] },
        terminalLayoutsByTabId: {},
        terminalTopologyRevisionByRepoId: { repo1: 8 },
        terminalSurfaceTombstonesByPaneKey: {
          'host-tab:leaf': {
            worktreeId: OLD,
            parentTabId: 'host-tab',
            leafId: 'leaf',
            ptyId: 'host-pty',
            incarnationId: 'host-incarnation',
            retiredAt: 1
          }
        }
      },
      'runtime:env-a'
    )

    store.migrateWorktreeIdentity(hostWorktreeTarget({ id: OLD, hostId: 'local' }), NEW)

    expect(store.getWorktreeMeta(OLD)).toBeUndefined()
    const meta = store.getWorktreeMeta(NEW)
    expect(meta?.displayName).toBe('Cunner')
    expect(meta?.linkedIssue).toBe(42)
    expect(meta?.priorWorktreeIds).toEqual([OLD])

    expect(store.getWorktreeLineage(OLD)).toBeUndefined()
    expect(store.getWorktreeLineage(NEW)?.worktreeId).toBe(NEW)
    expect(store.getWorkspaceLineage(OLD_WORKSPACE_KEY)).toBeUndefined()
    expect(store.getWorkspaceLineage(NEW_WORKSPACE_KEY)?.childWorkspaceKey).toBe(NEW_WORKSPACE_KEY)
    expect(
      store.getWorkspaceLineage(worktreeWorkspaceKey('repo1::/ws/child'))?.parentWorkspaceKey
    ).toBe(NEW_WORKSPACE_KEY)

    // The live session's tab keeps its frozen ptyId but now belongs to the new id.
    expect(store.getWorktreeIdForTab('tab1')).toBe(NEW)
    const session = store.getWorkspaceSession()
    expect(session.tabsByWorktree[OLD]).toBeUndefined()
    expect(session.tabsByWorktree[NEW]?.[0]?.worktreeId).toBe(NEW)
    expect(session.activeWorkspaceKey).toBe(NEW_WORKSPACE_KEY)
    expect(session.activeWorktreeIdsOnShutdown).toEqual([NEW])
    expect(session.openFilesByWorktree?.[OLD]).toBeUndefined()
    expect(session.openFilesByWorktree?.[NEW]?.[0]?.worktreeId).toBe(NEW)
    expect(session.activeFileIdByWorktree?.[NEW]).toBe('/ws/cunner/a.ts')
    expect(session.browserTabsByWorktree?.[OLD]).toBeUndefined()
    expect(session.browserTabsByWorktree?.[NEW]?.[0]?.worktreeId).toBe(NEW)
    expect(session.browserPagesByWorkspace?.browser1?.[0]?.worktreeId).toBe(NEW)
    expect(session.browserTabsByWorktree?.[NEW]?.[0]?.docLocation).toEqual({
      kind: 'workspace-doc',
      worktreeId: NEW,
      filePath: '/ws/worktree-creation-spinner/docs/report.html'
    })
    expect(session.browserPagesByWorkspace?.browser1?.[0]?.docLocation).toEqual({
      kind: 'workspace-doc',
      worktreeId: NEW,
      filePath: '/ws/worktree-creation-spinner/docs/report.html'
    })
    expect(session.activeBrowserTabIdByWorktree?.[NEW]).toBe('browser1')
    expect(session.activeTabTypeByWorktree?.[NEW]).toBe('browser')
    expect(session.activeWorktreeId).toBe(NEW)
    expect(session.activeTabIdByWorktree?.[NEW]).toBe('tab1')
    expect(session.unifiedTabs?.[NEW]?.[0]?.worktreeId).toBe(NEW)
    expect(session.tabGroups?.[NEW]?.[0]?.worktreeId).toBe(NEW)
    expect(session.tabGroupLayouts?.[NEW]).toEqual({ type: 'leaf', groupId: 'group1' })
    expect(session.activeGroupIdByWorktree?.[NEW]).toBe('group1')
    expect(session.lastVisitedAtByWorktreeId?.[NEW]).toBe(123)
    expect(session.defaultTerminalTabsAppliedByWorktreeId?.[NEW]).toBe(true)
    expect(session.terminalTopologyRevisionByRepoId?.repo1).toBe(4)
    expect(session.sleepingAgentSessionsByPaneKey?.['tab1:leaf']?.worktreeId).toBe(NEW)

    const hostSession = store.getWorkspaceSession('runtime:env-a')
    expect(hostSession.tabsByWorktree[OLD]).toBeUndefined()
    expect(hostSession.tabsByWorktree[NEW]?.[0]?.worktreeId).toBe(NEW)
    expect(hostSession.activeWorkspaceKey).toBe(NEW_WORKSPACE_KEY)
    expect(hostSession.terminalTopologyRevisionByRepoId?.repo1).toBe(9)
    expect(hostSession.terminalSurfaceTombstonesByPaneKey).toEqual({})
  })

  it('rewrites parentWorktreeId back-references in other lineage entries', async () => {
    const store = await createStore()
    store.setWorktreeMeta(hostWorktreeTarget({ id: OLD, hostId: 'local' }), {
      displayName: 'Cunner'
    })
    const CHILD = 'repo1::/ws/child'
    store.setWorktreeLineage(
      hostWorktreeTarget({ id: CHILD, hostId: 'local' }),
      makeWorktreeLineage({ worktreeId: CHILD, parentWorktreeId: OLD })
    )

    store.migrateWorktreeIdentity(hostWorktreeTarget({ id: OLD, hostId: 'local' }), NEW)

    expect(store.getWorktreeLineage(CHILD)?.parentWorktreeId).toBe(NEW)
  })

  it('moves persisted mobile selections across reloads', async () => {
    const store = await createStore()
    // Registered on purpose: rows owned by an unregistered repo id are swept as orphans on load.
    store.addRepo(makeRepo({ id: 'repo1', path: '/repo1' }))
    store.setMobileClientTabSelections({
      'device-a': {
        [OLD]: { activeTabId: 'tab-1', activeGroupId: null, activeTabIdByGroupId: {} }
      }
    })

    store.migrateWorktreeIdentity(hostWorktreeTarget({ id: OLD, hostId: 'local' }), NEW)
    store.flush()

    expect(store.getMobileClientTabSelections()['device-a']?.[OLD]).toBeUndefined()
    const reloaded = await createStore()
    expect(reloaded.getMobileClientTabSelections()['device-a']?.[NEW]?.activeTabId).toBe('tab-1')
  })

  it('accumulates prior ids across chained renames', async () => {
    const store = await createStore()
    store.setWorktreeMeta(hostWorktreeTarget({ id: OLD, hostId: 'local' }), {
      displayName: 'Cunner'
    })
    store.migrateWorktreeIdentity(hostWorktreeTarget({ id: OLD, hostId: 'local' }), NEW)
    const NEWER = 'repo1::/ws/final-name'
    store.migrateWorktreeIdentity(hostWorktreeTarget({ id: NEW, hostId: 'local' }), NEWER)
    expect(store.getWorktreeMeta(NEWER)?.priorWorktreeIds).toEqual([OLD, NEW])
  })

  it('keeps the newest visit timestamp when a partial migration left both identities', async () => {
    const store = await createStore()
    store.setWorkspaceSession({
      ...getDefaultWorkspaceSession(),
      lastVisitedAtByWorktreeId: { [OLD]: 100, [NEW]: 900 }
    })

    store.migrateWorktreeIdentity(hostWorktreeTarget({ id: OLD, hostId: 'local' }), NEW)

    expect(store.getWorkspaceSession().lastVisitedAtByWorktreeId?.[OLD]).toBeUndefined()
    expect(store.getWorkspaceSession().lastVisitedAtByWorktreeId?.[NEW]).toBe(900)
  })

  it('is a no-op when the ids match', async () => {
    const store = await createStore()
    store.setWorktreeMeta(hostWorktreeTarget({ id: OLD, hostId: 'local' }), {
      displayName: 'Cunner'
    })
    store.migrateWorktreeIdentity(hostWorktreeTarget({ id: OLD, hostId: 'local' }), OLD)
    expect(store.getWorktreeMeta(OLD)?.priorWorktreeIds).toBeUndefined()
  })
})
