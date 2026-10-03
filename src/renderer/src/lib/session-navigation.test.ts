import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { SessionListItem } from '@/components/sessions/session-list-types'
import type { AppState } from '@/store/types'
import { findKnownWorktreeById } from '@/store/slices/worktrees/listing/detected-worktree-meta'
import {
  activateSessionInWorkspace,
  resolveSessionConnectionState,
  resolveSessionRuntimeEnvironmentId
} from './session-navigation'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  workspace: vi.fn(),
  floating: vi.fn(),
  structured: vi.fn(),
  focusPane: vi.fn()
}))
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('./worktree-activation', () => ({ activateAndRevealWorkspace: mocks.workspace }))
vi.mock('./temporary-session-navigation', () => ({
  activateTemporarySessionInMain: mocks.floating
}))
vi.mock('./structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionTab: mocks.structured
}))
vi.mock('./activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: mocks.focusPane }))

const LEAF = '11111111-1111-4111-8111-111111111111'
let state: AppState

function item(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    key: 'workspace|unified',
    id: 'terminal',
    title: 'Review',
    worktreeId: 'workspace',
    ownerBucketKey: 'workspace',
    unifiedTabId: 'unified',
    terminalTabId: 'terminal',
    tabId: 'unified',
    paneKey: null,
    executionHostId: 'local',
    kind: 'terminal',
    providerSessionId: null,
    agent: null,
    groupId: 'old-group',
    projectKey: null,
    projectLabel: null,
    workspaceLabel: 'Workspace',
    workspacePath: '/work',
    hostLabel: 'This computer',
    lastActivityAt: 1,
    status: {
      activity: 'unknown',
      reason: null,
      lastActivityAt: null,
      connection: 'connected',
      execution: 'unverifiable',
      executionReason: null
    },
    ...overrides
  }
}

function seed(
  workspaceId = 'workspace',
  host: ExecutionHostId = 'local',
  bucket = workspaceId
): SessionListItem {
  const floating = workspaceId === 'global-floating-terminal'
  state.unifiedTabsByWorktree[bucket] = [
    {
      id: 'unified',
      entityId: 'terminal',
      worktreeId: workspaceId,
      executionHostId: host,
      contentType: 'terminal',
      label: 'Review',
      customLabel: null,
      color: null,
      createdAt: 1,
      sortOrder: 0,
      groupId: 'current-group'
    }
  ]
  state.tabsByWorktree[bucket] = [
    {
      id: 'terminal',
      worktreeId: workspaceId,
      ptyId: 'live-pty',
      title: 'Review',
      customTitle: null,
      color: null,
      createdAt: 1,
      sortOrder: 0
    }
  ]
  state.groupsByWorktree[bucket] = [
    { id: 'current-group', worktreeId: workspaceId, tabOrder: ['unified'], activeTabId: null }
  ]
  if (!floating && !workspaceId.startsWith('folder:')) {
    state.worktreesByRepo[host] = [{ id: workspaceId, repoId: 'repo', hostId: host } as never]
  }
  if (workspaceId.startsWith('folder:')) {
    state.folderWorkspaces = [
      ...state.folderWorkspaces,
      {
        id: workspaceId.slice(7),
        projectGroupId: 'project',
        executionHostId: host,
        folderPath: '/folder'
      } as never
    ]
  }
  if (host.startsWith('ssh:')) {
    state.sshConnectionStates.set(host.slice(4), { status: 'connected' } as never)
  }
  if (host.startsWith('runtime:')) {
    state.runtimeStatusByEnvironmentId.set(host.slice(8), { status: { runtimeId: host } } as never)
  }
  return item({
    ownerBucketKey: bucket,
    worktreeId: floating ? null : workspaceId,
    executionHostId: host
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state = {
    activeView: 'sessions',
    activeWorktreeId: 'previous',
    activeWorkspaceExecutionHostId: null,
    tabsByWorktree: {},
    unifiedTabsByWorktree: {},
    groupsByWorktree: {},
    terminalLayoutsByTabId: {},
    worktreesByRepo: {},
    detectedWorktreesByRepo: {},
    folderWorkspaces: [],
    projectGroups: [],
    repos: [],
    agentStatusByPaneKey: {},
    settings: {},
    runtimeEnvironments: [],
    runtimeStatusByEnvironmentId: new Map(),
    sshConnectionStates: new Map(),
    sshStateByEnvironment: new Map(),
    setActiveTabForWorktree: vi.fn(),
    setActiveTabType: vi.fn(),
    focusGroup: vi.fn(),
    activateTab: vi.fn(),
    getKnownWorktreeById: (id: string, host?: ExecutionHostId) =>
      findKnownWorktreeById(state, id, host)
  } as unknown as AppState
  mocks.getState.mockImplementation(() => state)
  mocks.workspace.mockImplementation((workspaceId: string) => {
    state.activeWorktreeId = workspaceId
    state.activeView = 'terminal'
    return { primaryTabId: null }
  })
  mocks.floating.mockImplementation((target: { ownerBucketKey: string }) => {
    state.activeWorktreeId = target.ownerBucketKey
    state.activeView = 'terminal'
    return true
  })
  mocks.structured.mockReturnValue(true)
})

function expectNoNavigation(): void {
  expect(state.activeView).toBe('sessions')
  expect(state.activeWorktreeId).toBe('previous')
  expect(mocks.workspace).not.toHaveBeenCalled()
  expect(mocks.floating).not.toHaveBeenCalled()
  expect(mocks.structured).not.toHaveBeenCalled()
  expect(mocks.focusPane).not.toHaveBeenCalled()
  expect(state.activateTab).not.toHaveBeenCalled()
  expect(state.focusGroup).not.toHaveBeenCalled()
}

describe('activateSessionInWorkspace', () => {
  it.each(['local', 'ssh:server', 'runtime:peer'] as const)(
    'restores a current worktree on %s without requesting an initial shell',
    async (host) => {
      const row = seed('workspace', host)
      await expect(activateSessionInWorkspace(row)).resolves.toEqual({ ok: true })
      expect(mocks.workspace).toHaveBeenCalledWith('workspace', {
        executionHostId: host,
        providesInitialSurface: true,
        clearSidebarFilters: false
      })
      expect(state.focusGroup).toHaveBeenCalledWith('workspace', 'current-group')
      expect(state.activateTab).toHaveBeenCalledWith('unified', { worktreeId: 'workspace' })
      expect(mocks.focusPane).toHaveBeenCalledWith('terminal', null)
    }
  )

  it.each(['local', 'ssh:server', 'runtime:peer'] as const)(
    'uses the common folder dispatcher on %s',
    async (host) => {
      const row = seed('folder:notes', host)
      await expect(activateSessionInWorkspace(row)).resolves.toEqual({ ok: true })
      expect(mocks.workspace).toHaveBeenCalledWith(
        'folder:notes',
        expect.objectContaining({ executionHostId: host, providesInitialSurface: true })
      )
    }
  )

  it('selects the exact temporary bucket when two hosts publish the same tab and provider ids', async () => {
    seed('global-floating-terminal', 'runtime:other', 'runtime:other|global-floating-terminal')
    const row = seed(
      'global-floating-terminal',
      'runtime:peer',
      'runtime:peer|global-floating-terminal'
    )
    await expect(activateSessionInWorkspace(row)).resolves.toEqual({ ok: true })
    expect(mocks.floating).toHaveBeenCalledWith({
      ownerBucketKey: 'runtime:peer|global-floating-terminal',
      executionHostId: 'runtime:peer',
      unifiedTabId: 'unified',
      terminalTabId: 'terminal'
    })
    expect(state.focusGroup).toHaveBeenCalledWith(
      'runtime:peer|global-floating-terminal',
      'current-group'
    )
    expect(mocks.workspace).not.toHaveBeenCalled()
  })

  it('restores a specific surviving split pane instead of choosing the first leaf', async () => {
    const row = seed()
    state.terminalLayoutsByTabId.terminal = {
      root: {
        type: 'split',
        direction: 'horizontal',
        first: { type: 'leaf', leafId: '22222222-2222-4222-8222-222222222222' },
        second: { type: 'leaf', leafId: LEAF }
      },
      activeLeafId: null,
      expandedLeafId: null
    }
    await expect(
      activateSessionInWorkspace({ ...row, paneKey: `terminal:${LEAF}` })
    ).resolves.toEqual({ ok: true })
    expect(mocks.focusPane).toHaveBeenCalledWith('terminal', LEAF)
  })

  it.each([
    { ownerBucketKey: null },
    { executionHostId: null },
    { ownerBucketKey: 'runtime:peer|global-floating-terminal', executionHostId: 'local' }
  ] as Partial<SessionListItem>[])(
    'keeps the page on missing or conflicting identity %j',
    async (override) => {
      const row = seed()
      await expect(activateSessionInWorkspace({ ...row, ...override })).resolves.toEqual({
        ok: false,
        reason: 'ambiguous'
      })
      expectNoNavigation()
    }
  )

  it.each([
    { unifiedTabId: 'closed' },
    { kind: 'structured' as const },
    { terminalTabId: 'other-terminal' },
    { worktreeId: 'other-workspace' },
    { providerSessionId: 'replaced-provider' },
    { paneKey: `terminal:${LEAF}` },
    { paneKey: `another:${LEAF}` }
  ])('refuses stale identity %j before changing the page', async (override) => {
    const row = seed()
    await expect(activateSessionInWorkspace({ ...row, ...override })).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    expectNoNavigation()
  })

  it('re-reads canonical inventory rather than accepting a removed list row', async () => {
    const row = seed()
    state = { ...state, unifiedTabsByWorktree: {}, tabsByWorktree: {} }
    await expect(activateSessionInWorkspace(row)).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    expectNoNavigation()
  })

  it('rejects an old provider token after a terminal starts another session', async () => {
    const row = seed()
    state.tabsByWorktree.workspace[0].aiVaultTitle = {
      agent: 'codex',
      sessionId: 'old',
      title: 'Old'
    }
    state.terminalLayoutsByTabId.terminal = {
      root: { type: 'leaf', leafId: LEAF },
      activeLeafId: LEAF,
      expandedLeafId: null
    }
    state.agentStatusByPaneKey[`terminal:${LEAF}`] = {
      providerSession: { key: 'session_id', id: 'new' }
    } as never
    await expect(
      activateSessionInWorkspace({ ...row, paneKey: `terminal:${LEAF}`, providerSessionId: 'old' })
    ).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expectNoNavigation()
  })

  it('refuses duplicate tab identities inside one owner bucket', async () => {
    const row = seed()
    state.unifiedTabsByWorktree.workspace.push({ ...state.unifiedTabsByWorktree.workspace[0] })
    await expect(activateSessionInWorkspace(row)).resolves.toEqual({
      ok: false,
      reason: 'ambiguous'
    })
    expectNoNavigation()
  })

  it('refuses a legacy bucket whose catalog ownership is ambiguous instead of using the active host', async () => {
    const row = seed()
    delete state.unifiedTabsByWorktree.workspace[0].executionHostId
    state.worktreesByRepo.peer = [
      { id: 'workspace', repoId: 'repo', hostId: 'runtime:peer' } as never
    ]
    state.activeWorkspaceExecutionHostId = 'local'
    await expect(activateSessionInWorkspace(row)).resolves.toEqual({
      ok: false,
      reason: 'ambiguous'
    })
    expectNoNavigation()
  })

  it.each(['ssh:server', 'runtime:peer'] as const)(
    'keeps the page when %s disconnects after projection',
    async (host) => {
      const row = seed('workspace', host)
      state.sshConnectionStates.clear()
      state.runtimeStatusByEnvironmentId.clear()
      await expect(activateSessionInWorkspace(row)).resolves.toEqual({
        ok: false,
        reason: 'disconnected'
      })
      expectNoNavigation()
    }
  )

  it('does not activate a qualified non-floating bucket through a different raw workspace surface', async () => {
    const row = seed('workspace', 'runtime:peer', 'runtime:peer|workspace')
    await expect(activateSessionInWorkspace(row)).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    expectNoNavigation()
  })

  it('uses the existing structured activation with the app session handle and exact host', async () => {
    const row = seed('workspace', 'runtime:peer')
    Object.assign(state.unifiedTabsByWorktree.workspace[0], {
      contentType: 'agent-session',
      entityId: 'app-session',
      structuredSessionId: 'provider'
    })
    state.tabsByWorktree = {}
    await expect(
      activateSessionInWorkspace({
        ...row,
        kind: 'structured',
        terminalTabId: null,
        providerSessionId: 'provider'
      })
    ).resolves.toEqual({ ok: true })
    expect(mocks.structured).toHaveBeenCalledWith({
      worktreeId: 'workspace',
      tabId: 'unified',
      executionHostId: 'runtime:peer'
    })
    expect(mocks.focusPane).not.toHaveBeenCalled()
  })

  it('does not invoke structured activation twice for a floating structured session', async () => {
    const row = seed('global-floating-terminal')
    Object.assign(state.unifiedTabsByWorktree['global-floating-terminal'][0], {
      contentType: 'agent-session',
      entityId: 'app-session'
    })
    await expect(
      activateSessionInWorkspace({ ...row, kind: 'structured', terminalTabId: null })
    ).resolves.toEqual({ ok: true })
    expect(mocks.floating).toHaveBeenCalledOnce()
    expect(mocks.structured).not.toHaveBeenCalled()
  })

  it('retains the page when the existing workspace gate rejects activation', async () => {
    const row = seed('folder:notes')
    mocks.workspace.mockReturnValue(false)
    await expect(activateSessionInWorkspace(row)).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    expect(state.activeView).toBe('sessions')
    expect(mocks.focusPane).not.toHaveBeenCalled()
  })
})

describe('resolveSessionConnectionState', () => {
  it('uses closed control transport even when a cached runtime status still says ready', () => {
    seed('workspace', 'runtime:peer')
    state.runtimeStatusByEnvironmentId.set('peer', {
      status: { remoteControl: { state: 'ready' } },
      remoteControl: { state: 'closed' }
    } as never)
    expect(resolveSessionConnectionState(state, 'workspace', 'runtime:peer')).toBe('disconnected')
    expect(resolveSessionRuntimeEnvironmentId(state, 'workspace', 'runtime:peer')).toBe('peer')
  })
  it('does not mistake a reconnecting runtime with cached status for connected', () => {
    seed('workspace', 'runtime:peer')
    state.runtimeStatusByEnvironmentId.set('peer', {
      status: { remoteControl: { state: 'reconnecting' } }
    } as never)
    expect(resolveSessionConnectionState(state, 'workspace', 'runtime:peer')).toBe('reconnecting')
  })

  it('reads an SSH target through its owning runtime, not an identically named local connection', () => {
    seed('workspace', 'ssh:server')
    state.worktreesByRepo['ssh:server'][0].runtimeOwnerEnvironmentId = 'hub'
    expect(resolveSessionRuntimeEnvironmentId(state, 'workspace', 'ssh:server')).toBe('hub')
    state.runtimeStatusByEnvironmentId.set('hub', { status: {} } as never)
    state.sshStateByEnvironment.set('hub', {
      targetsHydrated: true,
      connectionStates: new Map([['server', { status: 'disconnected' }]])
    } as never)
    expect(resolveSessionConnectionState(state, 'workspace', 'ssh:server')).toBe('disconnected')
  })
})
