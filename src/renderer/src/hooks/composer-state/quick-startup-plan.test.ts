import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { buildQuickComposerStartup } from './quick-startup-plan'

function settings(agentDefaultArgs: Record<string, string>): GlobalSettings {
  return {
    agentCmdOverrides: {},
    agentDefaultArgs,
    agentDefaultEnv: {}
  } as GlobalSettings
}

function build(permissionMode: 'default' | 'manual' | 'yolo', agentDefaultArgs: string) {
  return buildQuickComposerStartup({
    agent: 'codex',
    prompt: 'implement the task',
    draftPrompt: null,
    settings: settings({ codex: agentDefaultArgs }),
    agentPermissionMode: permissionMode,
    repoConnectionId: null,
    platform: 'linux',
    shell: 'posix',
    isRemote: false,
    telemetrySource: 'unknown'
  })
}

describe('buildQuickComposerStartup permission mode', () => {
  it('inherits configured permissions in default mode', () => {
    const { startupPlan, backendStartup } = build(
      'default',
      '--model gpt-5 --dangerously-bypass-approvals-and-sandbox'
    )

    expect(startupPlan?.launchCommand).toContain('dangerously-bypass-approvals-and-sandbox')
    expect(backendStartup?.command).toContain('dangerously-bypass-approvals-and-sandbox')
    expect(backendStartup?.launchConfig?.agentArgs).toContain(
      'dangerously-bypass-approvals-and-sandbox'
    )
  })

  it('forces manual permission while preserving unrelated arguments', () => {
    const { startupPlan, backendStartup } = build(
      'manual',
      '--model gpt-5 --dangerously-bypass-approvals-and-sandbox'
    )

    expect(startupPlan?.launchCommand).toContain("'--model' 'gpt-5'")
    expect(startupPlan?.launchCommand).not.toContain('dangerously-bypass-approvals-and-sandbox')
    expect(backendStartup?.command).toContain("'--model' 'gpt-5'")
    expect(backendStartup?.command).not.toContain('dangerously-bypass-approvals-and-sandbox')
    expect(backendStartup?.launchConfig?.agentArgs).toBe(
      "'--model' 'gpt-5' '--ask-for-approval' 'on-request' '--sandbox' 'workspace-write'"
    )
  })

  it('adds auto-approval to a manual configured launch', () => {
    const { startupPlan, backendStartup } = build('yolo', '--model gpt-5')

    expect(startupPlan?.launchCommand).toContain("'--model' 'gpt-5'")
    expect(startupPlan?.launchCommand).toContain("'--dangerously-bypass-approvals-and-sandbox'")
    expect(backendStartup?.command).toContain('dangerously-bypass-approvals-and-sandbox')
    expect(backendStartup?.launchConfig?.agentArgs).toContain(
      'dangerously-bypass-approvals-and-sandbox'
    )
  })

  it('keeps environment-backed permissions in the backend launch for follow-up agents', () => {
    const { startupPlan, backendStartup } = buildQuickComposerStartup({
      agent: 'goose',
      prompt: 'implement the task',
      draftPrompt: null,
      settings: settings({}),
      agentPermissionMode: 'yolo',
      repoConnectionId: 'runtime-host',
      platform: 'linux',
      shell: 'posix',
      isRemote: true,
      telemetrySource: 'unknown'
    })

    expect(startupPlan?.followupPrompt).toBe('implement the task')
    expect(backendStartup).toMatchObject({
      command: 'goose',
      env: { GOOSE_MODE: 'auto' },
      launchConfig: { agentEnv: { GOOSE_MODE: 'auto' } },
      launchAgent: 'goose'
    })
  })

  it('keeps default follow-up agents on the Renderer launch path', () => {
    const { startupPlan, backendStartup } = buildQuickComposerStartup({
      agent: 'goose',
      prompt: 'implement the task',
      draftPrompt: null,
      settings: settings({}),
      agentPermissionMode: 'default',
      repoConnectionId: 'runtime-host',
      platform: 'linux',
      shell: 'posix',
      isRemote: true,
      telemetrySource: 'unknown'
    })

    expect(startupPlan?.followupPrompt).toBe('implement the task')
    expect(backendStartup).toBeUndefined()
  })
})
