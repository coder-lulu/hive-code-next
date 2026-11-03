import { describe, expect, it } from 'vitest'
import {
  buildAgentStartupPlan,
  buildAgentDraftLaunchPlan,
  buildAgentResumeStartupPlan
} from './tui-agent-startup'

describe('explicit launch permissions across split startup owners', () => {
  it('replaces bypass flags while retaining Codex input and update suppression fixes', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: 'hello',
      platform: 'linux',
      cmdOverrides: { codex: 'codex -a never -s danger-full-access' },
      agentPermissionMode: 'manual',
      suppressStartupUpdatePrompt: true
    })
    expect(plan?.launchCommand).toContain("'--ask-for-approval' 'on-request'")
    expect(plan?.launchCommand).toContain('disable_paste_burst=true')
    expect(plan?.launchCommand).toContain('check_for_update_on_startup=false')
    expect(plan?.launchCommand).not.toContain('danger-full-access')
  })
  it('carries explicit policy into draft launches', () => {
    const plan = buildAgentDraftLaunchPlan({
      agent: 'claude',
      draft: 'hello',
      platform: 'linux',
      cmdOverrides: {},
      agentPermissionMode: 'manual'
    })
    expect(plan?.launchCommand).toContain("'--permission-mode' 'manual'")
    expect(plan?.launchConfig.agentPermissionMode).toBe('manual')
  })
  it('drops recorded Codex grants but applies a newly explicit safe policy', () => {
    const input = {
      agent: 'codex' as const,
      providerSession: { key: 'session_id' as const, id: 's1' },
      cmdOverrides: {},
      platform: 'linux' as const,
      agentCommand: "codex '--dangerously-bypass-approvals-and-sandbox'",
      agentArgs: '--dangerously-bypass-approvals-and-sandbox',
      resumeInLaunchCwd: true
    }
    const inherited = buildAgentResumeStartupPlan(input)
    expect(inherited?.launchCommand).not.toContain('dangerously-bypass')
    const explicit = buildAgentResumeStartupPlan({ ...input, agentPermissionMode: 'manual' })
    expect(explicit?.launchCommand).toContain("'--ask-for-approval' 'on-request'")
    expect(explicit?.launchCommand).not.toContain('dangerously-bypass')
    expect(explicit?.launchCommand).toContain('tui.resume_cwd=current')
  })
})

it('removes an assigned auto-approval flag from an override in manual mode', () => {
  const plan = buildAgentStartupPlan({
    agent: 'codex',
    prompt: 'fix it',
    cmdOverrides: {
      codex: 'codex --dangerously-bypass-approvals-and-sandbox=true --profile work'
    },
    agentPermissionMode: 'manual',
    platform: 'linux'
  })

  expect(plan?.launchCommand).toBe(
    "codex --profile work '--ask-for-approval' 'on-request' '--sandbox' 'workspace-write' '-c' 'disable_paste_burst=true' 'fix it'"
  )
})

it('replaces alternate Codex bypass options in an override with explicit safe options', () => {
  const plan = buildAgentStartupPlan({
    agent: 'codex',
    prompt: 'fix it',
    cmdOverrides: {
      codex: 'codex -a never -s danger-full-access --approve-for-me --profile work'
    },
    agentPermissionMode: 'manual',
    platform: 'linux'
  })

  expect(plan?.launchCommand).toBe(
    "codex --profile work '--ask-for-approval' 'on-request' '--sandbox' 'workspace-write' '-c' 'disable_paste_burst=true' 'fix it'"
  )
})
