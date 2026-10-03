import { vi, type Mock } from 'vitest'

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
  mockInspectRuntimeTerminalProcess: vi.fn() as Mock,
  mockSendRuntimePtyInputVerified: vi.fn() as Mock,
  mockPasteDraftToAgentPtyWhenReady: vi.fn() as Mock,
  mockShowAutomationPromptNotSentToast: vi.fn() as Mock,
  mockTrack: vi.fn() as Mock,
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
    registerAgentLaunchConfig: vi.fn() as Mock
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

export {
  mockInspectRuntimeTerminalProcess,
  mockSendRuntimePtyInputVerified,
  mockPasteDraftToAgentPtyWhenReady,
  mockShowAutomationPromptNotSentToast,
  mockTrack,
  store,
  storeListeners,
  startupLeafId,
  runtimeEnvironmentIdByWorktree
}
