import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInspectRuntimeTerminalProcess,
  mockSendRuntimePtyInputVerified,
  mockPasteDraftToAgentPtyWhenReady,
  mockShowAutomationPromptNotSentToast,
  mockTrack,
  store,
  storeListeners,
  startupLeafId,
  runtimeEnvironmentIdByWorktree
} = vi.hoisted(() => ({
  mockInspectRuntimeTerminalProcess: vi.fn(),
  mockSendRuntimePtyInputVerified: vi.fn(),
  mockPasteDraftToAgentPtyWhenReady: vi.fn(),
  mockShowAutomationPromptNotSentToast: vi.fn(),
  mockTrack: vi.fn(),
  storeListeners: new Set<(state: unknown, previousState: unknown) => void>(),
  startupLeafId: '11111111-1111-4111-8111-111111111111',
  runtimeEnvironmentIdByWorktree: {} as Record<string, string>,
  store: {
    settings: {},
    activeTabIdByWorktree: { 'wt-1': 'tab-1' } as Record<string, string>,
    tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] } as Record<string, { id: string }[]>,
    ptyIdsByTabId: { 'tab-1': ['pty-1'] } as Record<string, string[]>,
    pendingStartupByTabId: {} as Record<string, { launchToken?: string }>,
    terminalLayoutsByTabId: {
      'tab-1': {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { '11111111-1111-4111-8111-111111111111': 'pty-1' }
      }
    } as Record<
      string,
      {
        root: null
        activeLeafId: null
        expandedLeafId: null
        ptyIdsByLeafId?: Record<string, string>
      }
    >,
    agentLaunchConfigByPaneKey: {
      'tab-1:11111111-1111-4111-8111-111111111111': {
        launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} },
        registeredAt: 1,
        identity: {
          tabId: 'tab-1',
          leafId: '11111111-1111-4111-8111-111111111111',
          launchToken: 'launch-token-1'
        }
      }
    } as Record<
      string,
      {
        launchConfig: { agentCommand: string; agentArgs: string; agentEnv: Record<string, string> }
        registeredAt: number
        identity: { tabId?: string; leafId?: string; launchToken?: string; agentType?: string }
      }
    >,
    registerAgentLaunchConfig: vi.fn()
  }
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => store,
    subscribe: (listener: (state: unknown, previousState: unknown) => void) => {
      storeListeners.add(listener)
      return () => {
        storeListeners.delete(listener)
      }
    }
  }
}))

vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  inspectRuntimeTerminalProcess: mockInspectRuntimeTerminalProcess,
  sendRuntimePtyInputVerified: mockSendRuntimePtyInputVerified
}))

vi.mock('@/lib/agent-paste-draft', () => ({
  getSettingsForAgentTabRuntimeOwner: () => store.settings,
  pasteDraftToAgentPtyWhenReady: mockPasteDraftToAgentPtyWhenReady
}))

vi.mock('@/lib/browser-uuid', () => ({
  createBrowserUuid: () => 'launch-token-1'
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: (_state: unknown, worktreeId: string) =>
    runtimeEnvironmentIdByWorktree[worktreeId] ?? null
}))

vi.mock('@/lib/telemetry', () => ({
  track: mockTrack
}))

vi.mock('@/lib/agent-background-session-timeout-toast', () => ({
  showAutomationPromptNotSentToast: mockShowAutomationPromptNotSentToast
}))

import { ensureAgentStartupInTerminal } from './new-workspace'
import { resetAgentStartupDelayedDeliveryForTests } from './agent-startup-delayed-delivery'

describe('ensureAgentStartupInTerminal prompt delivery', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    storeListeners.clear()
    for (const worktreeId of Object.keys(runtimeEnvironmentIdByWorktree)) {
      delete runtimeEnvironmentIdByWorktree[worktreeId]
    }
    store.settings = {}
    store.activeTabIdByWorktree = { 'wt-1': 'tab-1' }
    store.tabsByWorktree = { 'wt-1': [{ id: 'tab-1' }] }
    store.ptyIdsByTabId = { 'tab-1': ['pty-1'] }
    store.pendingStartupByTabId = {}
    store.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { [startupLeafId]: 'pty-1' }
      }
    }
    store.agentLaunchConfigByPaneKey = {
      [`tab-1:${startupLeafId}`]: {
        launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} },
        registeredAt: 1,
        identity: { tabId: 'tab-1', leafId: startupLeafId, launchToken: 'launch-token-1' }
      }
    }
    store.registerAgentLaunchConfig.mockImplementation((paneKey, launchConfig, identity) => {
      store.agentLaunchConfigByPaneKey = {
        ...store.agentLaunchConfigByPaneKey,
        [paneKey]: { launchConfig, registeredAt: Date.now(), identity }
      }
    })
    mockInspectRuntimeTerminalProcess.mockResolvedValue({
      foregroundProcess: 'aider',
      hasChildProcesses: true
    })
    mockSendRuntimePtyInputVerified.mockResolvedValue(true)
    mockPasteDraftToAgentPtyWhenReady.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    resetAgentStartupDelayedDeliveryForTests()
  })

  it('sends a follow-up prompt through the terminal runtime without renderer telemetry', async () => {
    await ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      startup: {
        agent: 'aider',
        launchCommand: 'aider',
        expectedProcess: 'aider',
        followupPrompt: 'fix the spinner',
        launchConfig: { agentArgs: '', agentEnv: {} }
      }
    })

    expect(mockSendRuntimePtyInputVerified).toHaveBeenCalledWith(
      {},
      'pty-1',
      'fix the spinner\r',
      'launch'
    )
    expect(mockTrack).not.toHaveBeenCalledWith('agent_prompt_sent', expect.anything())
  })

  it('does not track when follow-up prompt delivery is rejected by the terminal runtime', async () => {
    mockSendRuntimePtyInputVerified.mockResolvedValue(false)

    await ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      startup: {
        agent: 'aider',
        launchCommand: 'aider',
        expectedProcess: 'aider',
        followupPrompt: 'fix the spinner',
        launchConfig: { agentArgs: '', agentEnv: {} }
      }
    })

    expect(mockTrack).not.toHaveBeenCalledWith('agent_prompt_sent', expect.anything())
  })

  it('surfaces the not-sent toast when a follow-up prompt is dropped', async () => {
    // Foreground never becomes a recognized agent and there is no live child,
    // so the readiness wait times out and the prompt is not delivered.
    mockInspectRuntimeTerminalProcess.mockResolvedValue({
      foregroundProcess: 'zsh',
      hasChildProcesses: false
    })

    await ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      startup: {
        agent: 'aider',
        launchCommand: 'aider',
        expectedProcess: 'aider',
        followupPrompt: 'fix the spinner',
        launchConfig: { agentArgs: '', agentEnv: {} }
      }
    })

    expect(mockSendRuntimePtyInputVerified).not.toHaveBeenCalled()
    expect(mockShowAutomationPromptNotSentToast).toHaveBeenCalledWith('aider')
  })

  it('does not toast when a follow-up prompt is delivered', async () => {
    await ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      startup: {
        agent: 'aider',
        launchCommand: 'aider',
        expectedProcess: 'aider',
        followupPrompt: 'fix the spinner',
        launchConfig: { agentArgs: '', agentEnv: {} }
      }
    })

    expect(mockShowAutomationPromptNotSentToast).not.toHaveBeenCalled()
  })

  it('passes an onTimeout that surfaces the not-sent toast to the draft paste path', async () => {
    await ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      startup: {
        agent: 'claude',
        launchCommand: 'claude',
        expectedProcess: 'claude',
        followupPrompt: null,
        launchConfig: { agentArgs: '', agentEnv: {} },
        draftPrompt: 'review this before sending'
      }
    })

    const call = mockPasteDraftToAgentPtyWhenReady.mock.calls.at(-1)?.[0] as
      | { onTimeout?: () => void }
      | undefined
    expect(call?.onTimeout).toBeTypeOf('function')
    call?.onTimeout?.()
    expect(mockShowAutomationPromptNotSentToast).toHaveBeenCalledWith('claude')
  })

  it('does not track when follow-up prompt delivery rejects', async () => {
    mockSendRuntimePtyInputVerified.mockRejectedValue(new Error('runtime timeout'))

    await expect(
      ensureAgentStartupInTerminal({
        worktreeId: 'wt-1',
        startup: {
          agent: 'aider',
          launchCommand: 'aider',
          expectedProcess: 'aider',
          followupPrompt: 'fix the spinner',
          launchConfig: { agentArgs: '', agentEnv: {} }
        }
      })
    ).resolves.toBeUndefined()

    expect(mockTrack).not.toHaveBeenCalledWith('agent_prompt_sent', expect.anything())
  })

  it('does not track draft prompt delivery as a sent prompt', async () => {
    await ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      startup: {
        agent: 'claude',
        launchCommand: 'claude',
        expectedProcess: 'claude',
        followupPrompt: null,
        launchConfig: { agentArgs: '', agentEnv: {} },
        draftPrompt: 'review this before sending'
      }
    })

    expect(mockPasteDraftToAgentPtyWhenReady).toHaveBeenCalledWith({
      tabId: 'tab-1',
      ptyId: 'pty-1',
      content: 'review this before sending',
      agent: 'claude',
      forcePaste: true,
      onTimeout: expect.any(Function)
    })
    expect(mockTrack).not.toHaveBeenCalledWith('agent_prompt_sent', expect.anything())
  })

  it('pastes drafts into the activation primary tab when active tab state differs', async () => {
    store.activeTabIdByWorktree = { 'wt-1': 'setup-tab' }
    store.tabsByWorktree = { 'wt-1': [{ id: 'setup-tab' }, { id: 'agent-tab' }] }
    store.ptyIdsByTabId = { 'setup-tab': ['setup-pty'], 'agent-tab': ['agent-pty'] }
    store.terminalLayoutsByTabId = {
      'agent-tab': {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { [startupLeafId]: 'agent-pty' }
      }
    }
    store.agentLaunchConfigByPaneKey = {
      [`agent-tab:${startupLeafId}`]: {
        launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} },
        registeredAt: 1,
        identity: { tabId: 'agent-tab', leafId: startupLeafId, launchToken: 'launch-token-1' }
      }
    }

    await ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: 'agent-tab',
      startup: {
        agent: 'codex',
        launchCommand: 'codex',
        expectedProcess: 'codex',
        followupPrompt: null,
        launchConfig: { agentArgs: '', agentEnv: {} },
        draftPrompt: 'Linear context draft'
      }
    })

    expect(mockPasteDraftToAgentPtyWhenReady).toHaveBeenCalledWith({
      tabId: 'agent-tab',
      ptyId: 'agent-pty',
      content: 'Linear context draft',
      agent: 'codex',
      forcePaste: true,
      onTimeout: expect.any(Function)
    })
  })

  it('pastes a draft after the seeded tab receives a delayed PTY', async () => {
    vi.useFakeTimers()
    store.ptyIdsByTabId = {}
    store.terminalLayoutsByTabId = {}
    store.agentLaunchConfigByPaneKey = {}
    store.pendingStartupByTabId = { 'tab-1': { launchToken: 'launch-token-1' } }

    const delivery = ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: 'tab-1',
      startup: {
        agent: 'codex',
        launchCommand: 'codex',
        expectedProcess: 'codex',
        followupPrompt: null,
        launchConfig: { agentArgs: '', agentEnv: {} },
        draftPrompt: 'https://github.com/stablyai/orca/pull/2051'
      }
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await delivery

    expect(mockPasteDraftToAgentPtyWhenReady).not.toHaveBeenCalled()

    store.ptyIdsByTabId = { 'tab-1': ['pty-delayed'] }
    store.pendingStartupByTabId = {}
    store.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { [startupLeafId]: 'pty-delayed' }
      }
    }
    store.agentLaunchConfigByPaneKey = {
      [`tab-1:${startupLeafId}`]: {
        launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} },
        registeredAt: 1,
        identity: { tabId: 'tab-1', leafId: startupLeafId, launchToken: 'launch-token-1' }
      }
    }
    for (const listener of storeListeners) {
      listener(store, store)
    }

    expect(mockPasteDraftToAgentPtyWhenReady).toHaveBeenCalledTimes(1)
    expect(mockPasteDraftToAgentPtyWhenReady).toHaveBeenCalledWith({
      tabId: 'tab-1',
      ptyId: 'pty-delayed',
      content: 'https://github.com/stablyai/orca/pull/2051',
      agent: 'codex',
      forcePaste: true,
      onTimeout: expect.any(Function)
    })
  })
})
