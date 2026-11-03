import { describe, expect, it } from 'vitest'
import {
  buildAgentDraftLaunchPlan,
  buildAgentResumeStartupPlan,
  buildAgentStartupPlan
} from './tui-agent-startup'
import { resolveAgentLaunchCommand } from './tui-agent-launch-command'

describe('tui agent startup session options', () => {
  it.each(['posix', 'powershell', 'cmd'] as const)(
    'clears inherited Goose permission env on %s but preserves own',
    (shell) => {
      const base = {
        agent: 'goose' as const,
        prompt: '',
        cmdOverrides: {},
        platform: 'win32' as const,
        shell,
        allowEmptyPromptLaunch: true,
        sessionOptionsOverrideAgentArgs: true
      }
      const ask = buildAgentStartupPlan({ ...base, sessionOptions: { permissionMode: 'ask' } })
      expect(ask?.launchCommand).toContain('GOOSE_MODE')
      expect(ask?.launchCommand).toContain('goose')
      const own = buildAgentStartupPlan({ ...base, sessionOptions: { permissionMode: 'own' } })
      expect(own?.launchCommand).toBe('goose')
    }
  )

  it.each([
    ['posix', 'GOOSE_MODE=auto goose'],
    ['powershell', "$env:goose_mode='auto'; goose"],
    ['cmd', 'set "goose_mode=auto" & goose']
  ] as const)('rejects a %s override that reintroduces Goose permission env', (shell, override) => {
    expect(
      buildAgentStartupPlan({
        agent: 'goose',
        prompt: '',
        cmdOverrides: { goose: override },
        platform: 'win32',
        shell,
        allowEmptyPromptLaunch: true,
        sessionOptions: { permissionMode: 'ask' },
        sessionOptionsOverrideAgentArgs: true
      })
    ).toBeNull()
  })
  it('replaces proven raw permission flags with an explicit launch choice', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      agentArgs: '--search -a never -s danger-full-access -c approvals_reviewer=guardian',
      sessionOptions: { permissionMode: 'ask' },
      sessionOptionsOverrideAgentArgs: true
    })
    expect(plan?.launchCommand).toContain("'--search'")
    expect(plan?.launchCommand).toContain("'-a' 'on-request'")
    expect(plan?.launchCommand).toContain("'-s' 'read-only'")
    expect(plan?.launchCommand).toContain("'approvals_reviewer=user'")
    expect(plan?.launchCommand).not.toContain('guardian')
    expect(plan?.launchCommand).not.toContain('danger-full-access')
  })

  it('preserves permission-looking model operands and arguments after the terminator', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      agentArgs: "--model '--dangerously-skip-permissions' -- --permission-mode bypassPermissions",
      sessionOptions: { permissionMode: 'ask' },
      sessionOptionsOverrideAgentArgs: true
    })
    expect(plan?.launchCommand).toContain("'--model' '--dangerously-skip-permissions'")
    expect(plan?.launchCommand).toContain(
      "'--permission-mode' 'default' '--' '--permission-mode' 'bypassPermissions'"
    )
  })

  it('refuses an ambiguous permission carrier rather than silently keeping a bypass', () => {
    expect(
      resolveAgentLaunchCommand({
        agent: 'claude',
        cmdOverrides: {},
        platform: 'linux',
        shell: 'posix',
        agentArgs: '--unknown-wrapper value --dangerously-skip-permissions',
        sessionOptions: { permissionMode: 'ask' },
        sessionOptionsOverrideAgentArgs: true
      })
    ).toMatchObject({
      ok: false,
      error: 'CLI permission flags conflict with the requested launch preferences.'
    })
  })

  it('keeps the user permission flags when the explicit choice is own', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      agentArgs: '--dangerously-skip-permissions --verbose',
      sessionOptions: { permissionMode: 'own' },
      sessionOptionsOverrideAgentArgs: true
    })
    expect(plan?.launchCommand).toContain("'--dangerously-skip-permissions' '--verbose'")
  })
  it('lets explicit worker preferences override general agent arguments', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'custom-codex-model', effort: 'high' },
      sessionOptionsOverrideAgentArgs: true,
      agentArgs: '-m gpt-5.5 -c model_reasoning_effort=low'
    })
    expect(plan?.launchCommand).toBe(
      "codex '-c' 'disable_paste_burst=true' '-m' 'custom-codex-model' '-c' 'model_reasoning_effort=high'"
    )
    expect(plan?.launchConfig).toMatchObject({ agentCommand: 'codex', agentArgs: '' })
    expect(plan?.sessionOptions).toEqual({ model: 'custom-codex-model', effort: 'high' })
  })

  it('keeps OpenCode agent arguments while replacing only the per-launch model', () => {
    const plan = buildAgentStartupPlan({
      agent: 'opencode',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'zai-coding-plan/glm-5.3-flash' },
      sessionOptionsOverrideAgentArgs: true,
      agentArgs: '--share --model opencode/global-default'
    })
    expect(plan?.launchCommand).toBe("opencode '--share' '--model' 'zai-coding-plan/glm-5.3-flash'")
    expect(plan?.launchConfig).toMatchObject({
      agentCommand: "opencode '--share'",
      agentArgs: "'--share'"
    })
    expect(plan?.sessionOptions).toEqual({ model: 'zai-coding-plan/glm-5.3-flash' })
  })

  it('rejects conflicting singleton flags in an agent command override', () => {
    expect(
      resolveAgentLaunchCommand({
        agent: 'codex',
        cmdOverrides: { codex: 'codex --profile work -m gpt-5.5' },
        platform: 'linux',
        shell: 'posix',
        sessionOptions: { model: 'custom-codex-model', effort: 'high' },
        sessionOptionsOverrideAgentArgs: true
      })
    ).toEqual({
      ok: false,
      error:
        'Agent command override conflicts with the requested launch preferences. Remove model, effort or permission flags from the command override.'
    })
  })

  it('keeps one-time picker flags out of the command captured for resume', () => {
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: 'gpt-5.6-sol', effort: 'medium' },
      agentArgs: '--dangerously-bypass-approvals-and-sandbox'
    })
    expect(plan?.launchConfig.agentCommand).toBe(
      "codex '--dangerously-bypass-approvals-and-sandbox'"
    )
  })

  it('quotes option values for a remote POSIX launch', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: '',
      cmdOverrides: {},
      platform: 'linux',
      isRemote: true,
      allowEmptyPromptLaunch: true,
      sessionOptions: { model: "team's-model", effort: 'high' }
    })
    expect(plan?.launchCommand).toContain(`'team'"'"'s-model'`)
  })

  it('lets explicit worker preferences override configured arguments in draft launches', () => {
    const plan = buildAgentDraftLaunchPlan({
      agent: 'claude',
      draft: 'review this',
      cmdOverrides: {},
      platform: 'linux',
      agentArgs: '--model haiku --effort low',
      sessionOptions: { model: 'opus', effort: 'high' },
      sessionOptionsOverrideAgentArgs: true
    })

    expect(plan?.launchCommand).toContain(
      "claude '--model' 'opus' '--effort' 'high' --prefill 'review this'"
    )
    expect(plan?.launchCommand).not.toContain('haiku')
    expect(plan?.launchCommand).not.toContain("'low'")
  })

  it('applies explicit session options to resume commands', () => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 'thread-1' },
      cmdOverrides: {},
      platform: 'linux',
      agentArgs: '-m gpt-5.6-sol -c model_reasoning_effort=medium',
      sessionOptions: { model: 'gpt-5.5', effort: 'high' },
      sessionOptionsOverrideAgentArgs: true
    })
    expect(plan?.launchCommand).toBe(
      "codex '-c' 'disable_paste_burst=true' '-m' 'gpt-5.5' '-c' 'model_reasoning_effort=high' 'resume' 'thread-1'"
    )
    expect(plan?.launchConfig).toMatchObject({ agentCommand: 'codex', agentArgs: '' })
    expect(plan?.sessionOptions).toEqual({ model: 'gpt-5.5', effort: 'high' })
  })
})
