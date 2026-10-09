import { describe, expect, it } from 'vitest'
import { buildQuickCreationRequest, type QuickCreationRequestInput } from './quick-creation-request'
import { buildQuickComposerStartup } from './quick-startup-plan'

function createInput(
  overrides: Partial<QuickCreationRequestInput> = {}
): QuickCreationRequestInput {
  return {
    repoId: 'repo-1',
    ephemeralVmRecipe: undefined,
    indeterminateProgress: false,
    taskSourceContext: null,
    linkedWorkItem: null,
    workspaceRunContext: null,
    workspaceName: 'characterize-request',
    nameWasGenerated: false,
    displayName: undefined,
    selectedRepoIsGit: true,
    baseBranch: undefined,
    compareBaseRef: undefined,
    setupDecision: 'inherit',
    sparseDirectories: null,
    sparsePresetId: null,
    telemetrySource: undefined,
    linkedIssue: null,
    linkedPR: null,
    pushTarget: undefined,
    agent: null,
    linkedLinearIssue: undefined,
    linkedLinearIssueWorkspaceId: undefined,
    linkedLinearIssueOrganizationUrlKey: undefined,
    branchNameOverride: undefined,
    parentWorktreeId: null,
    workspaceStatus: undefined,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    includeGitLabLinks: true,
    startup: undefined,
    issueCommand: undefined,
    pendingFirstAgentMessageRename: false,
    note: '',
    startupPlan: null,
    quickPrompt: '',
    launchDraftPrompt: '',
    promptDelivery: 'auto-submit',
    quickTelemetry: null,
    suppressTerminalFocusOnCompletion: false,
    ...overrides
  }
}

describe('quick composer creation request', () => {
  it.each(['manual', 'yolo'] as const)(
    'retains the %s permission and session preferences used by current startup execution',
    (agentPermissionMode) => {
      const { startupPlan, backendStartup } = buildQuickComposerStartup({
        agent: 'codex',
        prompt: 'implement the task',
        draftPrompt: null,
        settings: undefined,
        agentPermissionMode,
        repoConnectionId: null,
        platform: 'linux',
        shell: 'posix',
        isRemote: false,
        telemetrySource: 'unknown'
      })
      if (!startupPlan || !backendStartup) {
        throw new Error('Expected a planned terminal startup')
      }
      const request = buildQuickCreationRequest(
        createInput({
          startup: backendStartup,
          startupPlan: { ...startupPlan, sessionOptions: { model: 'gpt-5.4', effort: 'high' } },
          quickPrompt: '  implement the task  '
        })
      )
      expect(request.startup?.agentPermissionMode).toBe(agentPermissionMode)
      expect(request.quickPrompt.trim()).toBe('implement the task')
      expect(request.startupPlan?.sessionOptions).toEqual({ model: 'gpt-5.4', effort: 'high' })
      expect(request.startupPlan?.agentPermissionMode).toBe(agentPermissionMode)
    }
  )

  it('preserves omission semantics for unset optional creation fields', () => {
    const request = buildQuickCreationRequest(createInput())

    expect(request).toEqual({
      repoId: 'repo-1',
      worktreeCreateProgressMode: 'stepped',
      linkedWorkItem: null,
      linkedTaskSourceContext: null,
      name: 'characterize-request',
      setupDecision: 'inherit',
      agent: null,
      pendingFirstAgentMessageRename: false,
      note: '',
      startupPlan: null,
      quickPrompt: '',
      promptDelivery: 'auto-submit',
      quickTelemetry: null
    })
    expect(request).not.toHaveProperty('baseBranch')
    expect(request).not.toHaveProperty('workspaceRunContext')
    expect(request).not.toHaveProperty('launchDraftPrompt')
  })

  it('keeps provider, branch, sparse, runtime, and startup fields in the quick wire payload', () => {
    const request = buildQuickCreationRequest(
      createInput({
        indeterminateProgress: true,
        nameWasGenerated: true,
        displayName: 'Characterize request',
        baseBranch: 'refs/pull/42/head',
        compareBaseRef: 'origin/main',
        sparseDirectories: ['src', 'tests'],
        sparsePresetId: 'preset-1',
        telemetrySource: 'shortcut',
        linkedIssue: 41,
        linkedPR: 42,
        pushTarget: { remoteName: 'origin', branchName: 'feature' },
        linkedLinearIssue: 'ENG-42',
        linkedLinearIssueWorkspaceId: 'workspace-1',
        linkedLinearIssueOrganizationUrlKey: 'orca',
        branchNameOverride: 'feature',
        parentWorktreeId: 'repo-1::/worktrees/parent',
        workspaceStatus: 'in-progress',
        linkedGitLabMR: 9,
        linkedGitLabIssue: 8,
        launchDraftPrompt: 'draft',
        promptDelivery: 'draft',
        suppressTerminalFocusOnCompletion: true
      })
    )

    expect(request).toMatchObject({
      worktreeCreateProgressMode: 'indeterminate',
      nameWasGenerated: true,
      displayName: 'Characterize request',
      baseBranch: 'refs/pull/42/head',
      compareBaseRef: 'origin/main',
      sparseCheckout: { directories: ['src', 'tests'], presetId: 'preset-1' },
      linkedIssue: 41,
      linkedPR: 42,
      linkedGitLabMR: 9,
      linkedGitLabIssue: 8,
      branchNameOverride: 'feature',
      parentWorktreeId: 'repo-1::/worktrees/parent',
      launchDraftPrompt: 'draft',
      promptDelivery: 'draft',
      suppressTerminalFocusOnCompletion: true
    })
  })

  it('drops repo-only and GitLab fields when their submit conditions are false', () => {
    const request = buildQuickCreationRequest(
      createInput({
        selectedRepoIsGit: false,
        baseBranch: 'main',
        compareBaseRef: 'origin/main',
        sparseDirectories: ['src'],
        linkedGitLabMR: 9,
        linkedGitLabIssue: 8,
        includeGitLabLinks: false
      })
    )

    expect(request).not.toHaveProperty('baseBranch')
    expect(request).not.toHaveProperty('compareBaseRef')
    expect(request).not.toHaveProperty('sparseCheckout')
    expect(request).not.toHaveProperty('linkedGitLabMR')
    expect(request).not.toHaveProperty('linkedGitLabIssue')
  })
})
