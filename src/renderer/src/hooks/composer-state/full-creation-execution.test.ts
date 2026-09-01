// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn(() => ({ primaryTabId: 'tab-1' })),
  ensureAgentStartupInTerminal: vi.fn(),
  queueWorkspaceActivationTerminalFocus: vi.fn(),
  seedNativeChatAppliedSessionOptions: vi.fn()
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))
vi.mock('@/lib/new-workspace', () => ({
  ensureAgentStartupInTerminal: mocks.ensureAgentStartupInTerminal,
  renderIssueCommandTemplate: vi.fn(() => '')
}))
vi.mock('@/components/native-chat/native-chat-session-option-cache', () => ({
  seedNativeChatAppliedSessionOptions: mocks.seedNativeChatAppliedSessionOptions
}))
vi.mock('@/lib/workspace-activation-terminal-focus', () => ({
  queueWorkspaceActivationTerminalFocus: mocks.queueWorkspaceActivationTerminalFocus
}))

import {
  resolveFullCreationSemanticStartupPrompt,
  useFullCreationExecution,
  type FullCreationExecutionInput
} from './full-creation-execution'
import type { PreparedFullSubmit } from './composer-submit-model'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('useFullCreationExecution cancellation', () => {
  it('forwards the prompt when the Host must rebuild a semantic permission startup', () => {
    expect(
      resolveFullCreationSemanticStartupPrompt(
        { agentPermissionMode: 'manual' },
        '  implement the task  '
      )
    ).toBe('implement the task')
    expect(resolveFullCreationSemanticStartupPrompt({ command: 'codex' } as never, 'task')).toBe(
      undefined
    )
  })

  it('preserves manual permission mode when Renderer owns the startup terminal', async () => {
    const prepared = {
      submitLinkedWorkItem: null,
      submitLinkedIssueNumber: null,
      submitLinkedPR: null,
      submitTitleName: null,
      nameIsAutoManaged: false,
      smartGitHubCreateNames: { workspaceName: 'workspace', displayName: undefined },
      workspaceName: 'workspace',
      nameWasGenerated: false,
      submitBaseBranch: 'main',
      submitCompareBaseRef: undefined,
      submitPushTarget: undefined,
      submitBranchNameOverride: undefined,
      submitLinkedWorkItemProvider: null,
      submitStartupPrompt: '',
      submitShouldRunIssueAutomation: false,
      effectiveSetupDecision: 'skip',
      issueCommandTrustDecision: 'skip',
      confirmedIssueCommandTemplate: '',
      linkedLinearIssue: undefined,
      linkedLinearIssueWorkspaceId: undefined,
      linkedLinearIssueOrganizationUrlKey: undefined,
      effectiveBranchNameOverride: undefined,
      createDisplayName: undefined,
      pendingFirstAgentMessageRename: false,
      startupPlan: {
        agent: 'goose',
        launchCommand: 'env -u GOOSE_MODE goose',
        expectedProcess: 'goose',
        followupPrompt: null,
        launchConfig: {
          agentCommand: 'env -u GOOSE_MODE goose',
          agentArgs: '',
          agentEnv: {}
        },
        launchToken: 'renderer-startup-token',
        agentPermissionMode: 'manual',
        sessionOptions: { model: 'gpt-5.6-sol', effort: 'high', fastMode: true }
      },
      shouldSeedInitialAgentStatus: false,
      composerTelemetry: {
        agent_kind: 'goose',
        launch_source: 'new_workspace_composer',
        request_kind: 'new'
      },
      backendStartup: undefined
    } satisfies PreparedFullSubmit
    const createWorktree = vi
      .fn<FullCreationExecutionInput['createWorktree']>()
      .mockResolvedValue({ worktree: { id: 'wt-1' } } as never)
    const state = {
      applyWorktreeMeta: vi
        .fn<FullCreationExecutionInput['applyWorktreeMeta']>()
        .mockResolvedValue(),
      clearNewWorkspaceDraft: vi.fn<FullCreationExecutionInput['clearNewWorkspaceDraft']>(),
      createWorktree,
      effectivePresetId: null,
      isSubmissionCancelled: () => false,
      linkedGitLabIssue: null,
      linkedGitLabMR: null,
      normalizedSparseDirectories: [],
      note: '',
      onCreated: vi.fn<NonNullable<FullCreationExecutionInput['onCreated']>>(),
      parentWorktreeId: null,
      persistDraft: false,
      persistSetupAgentStartupPolicy: vi.fn(async () => true),
      prepareFullSubmit: vi
        .fn<FullCreationExecutionInput['prepareFullSubmit']>()
        .mockResolvedValue(prepared),
      resolvedInitialWorkspaceStatus: undefined,
      selectedRepoIsGit: true,
      setSidebarOpen: vi.fn<FullCreationExecutionInput['setSidebarOpen']>(),
      sparseEnabled: false,
      taskSourceContext: null,
      telemetrySource: undefined,
      tuiAgent: 'goose'
    } satisfies FullCreationExecutionInput
    const hook = renderHook(() => useFullCreationExecution(state))

    await act(() => hook.result.current.executeFullCreation({ kind: 'none' }, 'repo-1'))

    expect(createWorktree.mock.calls[0]?.[25]).toEqual(
      expect.objectContaining({
        startupLaunchPreferences: { model: 'gpt-5.6-sol', effort: 'high' },
        requiresAgentLaunchPermissionCapability: true
      })
    )

    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({
        startup: expect.objectContaining({
          launchAgent: 'goose',
          agentPermissionMode: 'manual'
        })
      })
    )
  })

  it('does not create after dismissal while the late startup-policy preflight is pending', async () => {
    const startupPolicy = deferred<boolean>()
    let cancelled = false
    const createWorktree = vi.fn<FullCreationExecutionInput['createWorktree']>()
    const prepared = {
      submitLinkedWorkItem: null,
      submitLinkedIssueNumber: null,
      submitLinkedPR: null,
      submitTitleName: null,
      nameIsAutoManaged: false,
      smartGitHubCreateNames: {
        workspaceName: 'workspace',
        displayName: undefined
      },
      workspaceName: 'workspace',
      nameWasGenerated: false,
      submitBaseBranch: 'main',
      submitCompareBaseRef: undefined,
      submitPushTarget: undefined,
      submitBranchNameOverride: undefined,
      submitLinkedWorkItemProvider: null,
      submitStartupPrompt: '',
      submitShouldRunIssueAutomation: false,
      effectiveSetupDecision: 'skip',
      issueCommandTrustDecision: 'skip',
      confirmedIssueCommandTemplate: '',
      linkedLinearIssue: undefined,
      linkedLinearIssueWorkspaceId: undefined,
      linkedLinearIssueOrganizationUrlKey: undefined,
      effectiveBranchNameOverride: undefined,
      createDisplayName: undefined,
      pendingFirstAgentMessageRename: false,
      startupPlan: null,
      shouldSeedInitialAgentStatus: false,
      composerTelemetry: {
        agent_kind: 'claude-code',
        launch_source: 'new_workspace_composer',
        request_kind: 'new'
      },
      backendStartup: undefined
    } satisfies PreparedFullSubmit
    const persistSetupAgentStartupPolicy = vi.fn(() => startupPolicy.promise)
    const state = {
      applyWorktreeMeta: vi
        .fn<FullCreationExecutionInput['applyWorktreeMeta']>()
        .mockResolvedValue(),
      clearNewWorkspaceDraft: vi.fn<FullCreationExecutionInput['clearNewWorkspaceDraft']>(),
      createWorktree,
      effectivePresetId: null,
      isSubmissionCancelled: () => cancelled,
      linkedGitLabIssue: null,
      linkedGitLabMR: null,
      normalizedSparseDirectories: [],
      note: '',
      onCreated: vi.fn<NonNullable<FullCreationExecutionInput['onCreated']>>(),
      parentWorktreeId: null,
      persistDraft: false,
      persistSetupAgentStartupPolicy,
      prepareFullSubmit: vi
        .fn<FullCreationExecutionInput['prepareFullSubmit']>()
        .mockResolvedValue(prepared),
      resolvedInitialWorkspaceStatus: undefined,
      selectedRepoIsGit: true,
      setSidebarOpen: vi.fn<FullCreationExecutionInput['setSidebarOpen']>(),
      sparseEnabled: false,
      taskSourceContext: null,
      telemetrySource: undefined,
      tuiAgent: 'claude'
    } satisfies FullCreationExecutionInput
    const hook = renderHook(() => useFullCreationExecution(state))

    let creation!: Promise<void>
    act(() => {
      creation = hook.result.current.executeFullCreation({ kind: 'none' }, 'repo-1')
    })
    await act(() => Promise.resolve())
    expect(persistSetupAgentStartupPolicy).toHaveBeenCalledTimes(1)

    cancelled = true
    startupPolicy.resolve(true)
    await act(async () => creation)

    expect(createWorktree).not.toHaveBeenCalled()
  })
})
