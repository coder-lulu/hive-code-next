import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  mockInspectRuntimeTerminalProcess,
  mockSendRuntimePtyInputVerified,
  mockPasteDraftToAgentPtyWhenReady,
  mockShowAutomationPromptNotSentToast,
  mockTrack,
  store,
  storeListeners,
  startupLeafId,
  runtimeEnvironmentIdByWorktree
} from './__mocks__/new-workspace'

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

  it('binds a Host-created mirrored pane to the launch token before delayed delivery', async () => {
    vi.useFakeTimers()
    const rawTabId = 'host-agent-tab'
    const mirroredTabId = `web-terminal-${encodeURIComponent(rawTabId)}`
    const mirroredPaneKey = `${mirroredTabId}:${startupLeafId}`
    runtimeEnvironmentIdByWorktree['wt-1'] = 'env-1'
    store.tabsByWorktree = { 'wt-1': [] }
    store.ptyIdsByTabId = {}
    store.terminalLayoutsByTabId = {}
    store.pendingStartupByTabId = {}
    store.agentLaunchConfigByPaneKey = {}
    mockInspectRuntimeTerminalProcess.mockResolvedValue({
      foregroundProcess: 'goose',
      hasChildProcesses: true
    })
    const launchConfig = { agentCommand: 'goose', agentArgs: '', agentEnv: {} }

    const delivery = ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: rawTabId,
      startupPaneKey: `${rawTabId}:${startupLeafId}`,
      startup: {
        agent: 'goose',
        launchCommand: 'goose',
        expectedProcess: 'goose',
        followupPrompt: 'implement the task',
        launchConfig,
        launchToken: 'launch-token-1'
      }
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await delivery
    store.tabsByWorktree = { 'wt-1': [{ id: mirroredTabId }] }
    store.ptyIdsByTabId = { [mirroredTabId]: ['remote:env-1@@host-pty'] }
    store.terminalLayoutsByTabId = {
      [mirroredTabId]: {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { [startupLeafId]: 'remote:env-1@@host-pty' }
      }
    }
    for (const listener of storeListeners) {
      listener(store, store)
    }
    await vi.advanceTimersByTimeAsync(5_000)

    expect(store.registerAgentLaunchConfig).toHaveBeenCalledWith(
      mirroredPaneKey,
      {
        agentArgs: '',
        agentEnv: {},
        hostDefaultsAuthoritative: true
      },
      {
        agentType: 'goose',
        launchToken: 'launch-token-1',
        tabId: mirroredTabId,
        leafId: startupLeafId
      }
    )
    expect(mockSendRuntimePtyInputVerified).toHaveBeenCalledWith(
      {},
      'remote:env-1@@host-pty',
      'implement the task\r',
      'launch'
    )
  })

  it('binds only the first queued launch when Host startup tokens race for one pane', async () => {
    vi.useFakeTimers()
    const rawTabId = 'host-agent-tab'
    const mirroredTabId = `web-terminal-${encodeURIComponent(rawTabId)}`
    const mirroredPaneKey = `${mirroredTabId}:${startupLeafId}`
    runtimeEnvironmentIdByWorktree['wt-1'] = 'env-1'
    store.tabsByWorktree = { 'wt-1': [] }
    store.ptyIdsByTabId = {}
    store.terminalLayoutsByTabId = {}
    store.pendingStartupByTabId = {}
    store.agentLaunchConfigByPaneKey = {}
    mockInspectRuntimeTerminalProcess.mockResolvedValue({
      foregroundProcess: 'goose',
      hasChildProcesses: true
    })

    const first = ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: rawTabId,
      startupPaneKey: `${rawTabId}:${startupLeafId}`,
      startup: {
        agent: 'goose',
        launchCommand: 'goose',
        expectedProcess: 'goose',
        followupPrompt: 'first task',
        launchConfig: { agentArgs: '', agentEnv: {} },
        launchToken: 'launch-token-first'
      }
    })
    const second = ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: rawTabId,
      startupPaneKey: `${rawTabId}:${startupLeafId}`,
      startup: {
        agent: 'goose',
        launchCommand: 'goose',
        expectedProcess: 'goose',
        followupPrompt: 'second task',
        launchConfig: { agentArgs: '', agentEnv: {} },
        launchToken: 'launch-token-second'
      }
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await Promise.all([first, second])

    store.tabsByWorktree = { 'wt-1': [{ id: mirroredTabId }] }
    store.ptyIdsByTabId = { [mirroredTabId]: ['remote:env-1@@host-pty'] }
    store.terminalLayoutsByTabId = {
      [mirroredTabId]: {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { [startupLeafId]: 'remote:env-1@@host-pty' }
      }
    }
    for (const listener of storeListeners) {
      listener(store, store)
    }
    await vi.advanceTimersByTimeAsync(5_000)

    expect(store.registerAgentLaunchConfig).toHaveBeenCalledTimes(1)
    expect(store.agentLaunchConfigByPaneKey[mirroredPaneKey]?.identity.launchToken).toBe(
      'launch-token-first'
    )
    expect(mockSendRuntimePtyInputVerified).toHaveBeenCalledTimes(1)
    expect(mockSendRuntimePtyInputVerified).toHaveBeenCalledWith(
      {},
      'remote:env-1@@host-pty',
      'first task\r',
      'launch'
    )
  })

  it('does not overwrite a newer launch identity on the mirrored Host pane', async () => {
    vi.useFakeTimers()
    const rawTabId = 'host-agent-tab'
    const mirroredTabId = `web-terminal-${encodeURIComponent(rawTabId)}`
    const mirroredPaneKey = `${mirroredTabId}:${startupLeafId}`
    runtimeEnvironmentIdByWorktree['wt-1'] = 'env-1'
    store.tabsByWorktree = { 'wt-1': [] }
    store.ptyIdsByTabId = {}
    store.terminalLayoutsByTabId = {}
    store.pendingStartupByTabId = {}
    store.agentLaunchConfigByPaneKey = {}

    const delivery = ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: rawTabId,
      startupPaneKey: `${rawTabId}:${startupLeafId}`,
      startup: {
        agent: 'goose',
        launchCommand: 'goose',
        expectedProcess: 'goose',
        followupPrompt: 'stale task',
        launchConfig: { agentCommand: 'goose', agentArgs: '', agentEnv: {} },
        launchToken: 'launch-token-1'
      }
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await delivery
    store.tabsByWorktree = { 'wt-1': [{ id: mirroredTabId }] }
    store.ptyIdsByTabId = { [mirroredTabId]: ['remote:env-1@@host-pty'] }
    store.terminalLayoutsByTabId = {
      [mirroredTabId]: {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { [startupLeafId]: 'remote:env-1@@host-pty' }
      }
    }
    store.agentLaunchConfigByPaneKey = {
      [mirroredPaneKey]: {
        launchConfig: { agentCommand: 'goose', agentArgs: '--newer', agentEnv: {} },
        registeredAt: 2,
        identity: {
          tabId: mirroredTabId,
          leafId: startupLeafId,
          launchToken: 'launch-token-new'
        }
      }
    }
    store.registerAgentLaunchConfig.mockClear()
    for (const listener of storeListeners) {
      listener(store, store)
    }

    expect(store.registerAgentLaunchConfig).not.toHaveBeenCalled()
    expect(store.agentLaunchConfigByPaneKey[mirroredPaneKey]?.identity.launchToken).toBe(
      'launch-token-new'
    )
    expect(mockSendRuntimePtyInputVerified).not.toHaveBeenCalled()
  })

  it('keeps waiting when a non-startup split PTY appears before the startup PTY', async () => {
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
        draftPrompt: 'linked draft'
      }
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await delivery

    const splitLeafId = '22222222-2222-4222-8222-222222222222'
    store.ptyIdsByTabId = { 'tab-1': ['split-pty'] }
    store.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { [splitLeafId]: 'split-pty' }
      }
    }
    store.agentLaunchConfigByPaneKey = {
      [`tab-1:${splitLeafId}`]: {
        launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} },
        registeredAt: 1,
        identity: { tabId: 'tab-1', leafId: splitLeafId, launchToken: 'other-token' }
      }
    }
    for (const listener of storeListeners) {
      listener(store, store)
    }

    expect(mockPasteDraftToAgentPtyWhenReady).not.toHaveBeenCalled()

    store.ptyIdsByTabId = { 'tab-1': ['split-pty', 'startup-pty'] }
    store.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { [splitLeafId]: 'split-pty', [startupLeafId]: 'startup-pty' }
      }
    }
    store.agentLaunchConfigByPaneKey = {
      [`tab-1:${splitLeafId}`]: {
        launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} },
        registeredAt: 1,
        identity: { tabId: 'tab-1', leafId: splitLeafId, launchToken: 'other-token' }
      },
      [`tab-1:${startupLeafId}`]: {
        launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} },
        registeredAt: 2,
        identity: { tabId: 'tab-1', leafId: startupLeafId, launchToken: 'launch-token-1' }
      }
    }
    for (const listener of storeListeners) {
      listener(store, store)
    }

    expect(mockPasteDraftToAgentPtyWhenReady).toHaveBeenCalledTimes(1)
    expect(mockPasteDraftToAgentPtyWhenReady).toHaveBeenCalledWith({
      tabId: 'tab-1',
      ptyId: 'startup-pty',
      content: 'linked draft',
      agent: 'codex',
      forcePaste: true,
      onTimeout: expect.any(Function)
    })
  })

  it('does not duplicate delayed delivery across repeated store updates', async () => {
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
        draftPrompt: 'linked draft'
      }
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await delivery

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
      listener(store, store)
    }

    expect(mockPasteDraftToAgentPtyWhenReady).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate immediate delivery for the same launch token', async () => {
    const startup = {
      agent: 'codex' as const,
      launchCommand: 'codex',
      expectedProcess: 'codex',
      followupPrompt: null,
      launchConfig: { agentArgs: '', agentEnv: {} },
      draftPrompt: 'linked draft',
      launchToken: 'launch-token-1'
    }

    await ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: 'tab-1',
      startup
    })
    await ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: 'tab-1',
      startup
    })

    expect(mockPasteDraftToAgentPtyWhenReady).toHaveBeenCalledTimes(1)
  })

  it('keeps one delayed subscription and tears it down after delivery drains', async () => {
    vi.useFakeTimers()
    store.ptyIdsByTabId = {}
    store.terminalLayoutsByTabId = {}
    store.agentLaunchConfigByPaneKey = {}
    store.pendingStartupByTabId = { 'tab-1': { launchToken: 'launch-token-1' } }
    const startup = {
      agent: 'codex' as const,
      launchCommand: 'codex',
      expectedProcess: 'codex',
      followupPrompt: null,
      launchConfig: { agentArgs: '', agentEnv: {} },
      draftPrompt: 'linked draft',
      launchToken: 'launch-token-1'
    }

    const first = ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: 'tab-1',
      startup
    })
    const second = ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: 'tab-1',
      startup
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await Promise.all([first, second])

    expect(storeListeners.size).toBe(1)

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
    expect(storeListeners.size).toBe(0)
  })

  it('does not let a newer same-tab launch satisfy an older pending delivery', async () => {
    vi.useFakeTimers()
    store.ptyIdsByTabId = {}
    store.terminalLayoutsByTabId = {}
    store.agentLaunchConfigByPaneKey = {}
    store.pendingStartupByTabId = { 'tab-1': { launchToken: 'launch-token-old' } }

    const delivery = ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      primaryTabId: 'tab-1',
      startup: {
        agent: 'codex',
        launchCommand: 'codex',
        expectedProcess: 'codex',
        followupPrompt: null,
        launchConfig: { agentArgs: '', agentEnv: {} },
        draftPrompt: 'old linked draft',
        launchToken: 'launch-token-old'
      }
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await delivery

    store.pendingStartupByTabId = { 'tab-1': { launchToken: 'launch-token-new' } }
    for (const listener of storeListeners) {
      listener(store, store)
    }

    store.ptyIdsByTabId = { 'tab-1': ['pty-new'] }
    store.pendingStartupByTabId = {}
    store.terminalLayoutsByTabId = {
      'tab-1': {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { [startupLeafId]: 'pty-new' }
      }
    }
    store.agentLaunchConfigByPaneKey = {
      [`tab-1:${startupLeafId}`]: {
        launchConfig: { agentCommand: 'codex', agentArgs: '', agentEnv: {} },
        registeredAt: 1,
        identity: { tabId: 'tab-1', leafId: startupLeafId, launchToken: 'launch-token-old' }
      }
    }
    for (const listener of storeListeners) {
      listener(store, store)
    }

    expect(mockPasteDraftToAgentPtyWhenReady).not.toHaveBeenCalled()
  })

  it('does not write a delayed follow-up prompt on readiness timeout', async () => {
    vi.useFakeTimers()
    mockInspectRuntimeTerminalProcess.mockResolvedValue({
      foregroundProcess: 'zsh',
      hasChildProcesses: false
    })

    const delivery = ensureAgentStartupInTerminal({
      worktreeId: 'wt-1',
      startup: {
        agent: 'aider',
        launchCommand: 'aider',
        expectedProcess: 'aider',
        followupPrompt: 'fix the spinner',
        launchConfig: { agentArgs: '', agentEnv: {} }
      }
    })

    await vi.advanceTimersByTimeAsync(5_000)
    await delivery

    expect(mockSendRuntimePtyInputVerified).not.toHaveBeenCalled()
  })
})
