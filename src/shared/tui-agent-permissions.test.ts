import { describe, expect, it } from 'vitest'
import {
  applyAgentPermissionMode,
  resolveAgentPermissionModeSummary,
  resolveTuiAgentLaunchPermission,
  resolveTuiAgentPermissionMode,
  supportsTuiAgentLaunchPermission,
  YOLO_TUI_AGENT_ARGS,
  YOLO_TUI_AGENT_ENV
} from './tui-agent-permissions'

describe('tui agent permissions', () => {
  it('recognizes the current default profile as yolo', () => {
    expect(
      resolveAgentPermissionModeSummary({
        agentDefaultArgs: YOLO_TUI_AGENT_ARGS,
        agentDefaultEnv: YOLO_TUI_AGENT_ENV
      })
    ).toBe('yolo')
  })

  it('recognizes an empty profile as manual', () => {
    expect(resolveAgentPermissionModeSummary({ agentDefaultArgs: {}, agentDefaultEnv: {} })).toBe(
      'manual'
    )
  })

  it('preserves custom agent arguments when applying manual mode', () => {
    const result = applyAgentPermissionMode({
      mode: 'manual',
      agentDefaultArgs: {
        claude: '--dangerously-skip-permissions',
        codex: '--model gpt-5'
      },
      agentDefaultEnv: YOLO_TUI_AGENT_ENV
    })

    expect(result.agentDefaultArgs.claude).toBe('')
    expect(result.agentDefaultArgs.codex).toBe('--model gpt-5')
    expect(result.agentDefaultEnv.goose).toEqual({})
  })

  it('reports mixed when custom arguments are present', () => {
    expect(
      resolveAgentPermissionModeSummary({
        agentDefaultArgs: {
          ...YOLO_TUI_AGENT_ARGS,
          codex: '--model gpt-5'
        },
        agentDefaultEnv: YOLO_TUI_AGENT_ENV
      })
    ).toBe('mixed')
  })

  it('resolves one Codex yolo launch as yolo', () => {
    expect(
      resolveTuiAgentPermissionMode({
        agent: 'codex',
        agentArgs: YOLO_TUI_AGENT_ARGS.codex,
        agentEnv: {}
      })
    ).toBe('yolo')
  })

  it('resolves one empty Codex launch as manual', () => {
    expect(resolveTuiAgentPermissionMode({ agent: 'codex', agentArgs: '', agentEnv: {} })).toBe(
      'manual'
    )
  })

  it('switches Muse between yolo and manual arguments', () => {
    expect(
      applyAgentPermissionMode({
        mode: 'yolo',
        agentDefaultArgs: { muse: '' },
        agentDefaultEnv: {}
      }).agentDefaultArgs.muse
    ).toBe('--yolo')
    expect(
      applyAgentPermissionMode({
        mode: 'manual',
        agentDefaultArgs: { muse: '--yolo' },
        agentDefaultEnv: {}
      }).agentDefaultArgs.muse
    ).toBe('')
  })

  it('resolves custom Codex permission arguments as mixed', () => {
    expect(
      resolveTuiAgentPermissionMode({
        agent: 'codex',
        agentArgs: '--ask-for-approval on-request',
        agentEnv: {}
      })
    ).toBe('mixed')
  })

  it('resolves env-driven yolo launches', () => {
    expect(
      resolveTuiAgentPermissionMode({
        agent: 'goose',
        agentArgs: '',
        agentEnv: YOLO_TUI_AGENT_ENV.goose
      })
    ).toBe('yolo')
  })

  it('inherits configured launch permissions in default mode', () => {
    expect(
      resolveTuiAgentLaunchPermission({
        agent: 'codex',
        mode: 'default',
        agentArgs: '--model gpt-5 --dangerously-bypass-approvals-and-sandbox',
        agentEnv: { CODEX_PROFILE: 'review' },
        shell: 'posix'
      })
    ).toEqual({
      agentArgs: '--model gpt-5 --dangerously-bypass-approvals-and-sandbox',
      agentEnv: { CODEX_PROFILE: 'review' }
    })
  })

  it('removes auto-approval while preserving unrelated launch arguments', () => {
    const result = resolveTuiAgentLaunchPermission({
      agent: 'codex',
      mode: 'manual',
      agentArgs: '--model gpt-5 --dangerously-bypass-approvals-and-sandbox',
      agentEnv: { CODEX_PROFILE: 'review' },
      shell: 'posix'
    })

    expect(result.agentArgs).toContain("'--model' 'gpt-5'")
    expect(result.agentArgs).not.toContain('dangerously-bypass')
    expect(result.agentEnv).toEqual({ CODEX_PROFILE: 'review' })
  })

  it('forces explicit safe Codex options over alternate bypass flags in manual mode', () => {
    const result = resolveTuiAgentLaunchPermission({
      agent: 'codex',
      mode: 'manual',
      agentArgs: '--model gpt-5 -a never -s danger-full-access --approve-for-me',
      shell: 'posix'
    })

    expect(result.agentArgs).toBe(
      "'--model' 'gpt-5' '--ask-for-approval' 'on-request' '--sandbox' 'workspace-write'"
    )
  })

  it.each([
    {
      agent: 'claude' as const,
      input: '--model sonnet --permission-mode=bypassPermissions',
      expected: "'--model' 'sonnet' '--permission-mode' 'manual'"
    },
    {
      agent: 'gemini' as const,
      input: '--model pro -y --approval-mode yolo',
      expected: "'--model' 'pro' '--approval-mode' 'default'"
    },
    {
      agent: 'grok' as const,
      input: '--model fast --always-approve --permission-mode bypassPermissions',
      expected: "'--model' 'fast' '--permission-mode' 'default'"
    }
  ])('replaces alternate $agent bypass flags with explicit manual options', (testCase) => {
    expect(
      resolveTuiAgentLaunchPermission({
        agent: testCase.agent,
        mode: 'manual',
        agentArgs: testCase.input,
        shell: 'posix'
      }).agentArgs
    ).toBe(testCase.expected)
  })

  it.each([
    {
      agent: 'claude' as const,
      input: '--permission-mode manual',
      expected: "'--dangerously-skip-permissions'"
    },
    {
      agent: 'gemini' as const,
      input: '--approval-mode=default -y',
      expected: "'--yolo'"
    },
    {
      agent: 'grok' as const,
      input: '--permission-mode default --always-approve',
      expected: "'--permission-mode' 'bypassPermissions'"
    }
  ])('normalizes alternate $agent permission flags into canonical yolo', (testCase) => {
    expect(
      resolveTuiAgentLaunchPermission({
        agent: testCase.agent,
        mode: 'yolo',
        agentArgs: testCase.input,
        shell: 'posix'
      }).agentArgs
    ).toBe(testCase.expected)
  })

  it('adds auto-approval without replacing unrelated launch arguments', () => {
    const result = resolveTuiAgentLaunchPermission({
      agent: 'codex',
      mode: 'yolo',
      agentArgs: '--model gpt-5',
      agentEnv: { CODEX_PROFILE: 'review' },
      shell: 'powershell'
    })

    expect(result.agentArgs).toContain("'--model' 'gpt-5'")
    expect(result.agentArgs).toContain("'--dangerously-bypass-approvals-and-sandbox'")
    expect(result.agentEnv).toEqual({ CODEX_PROFILE: 'review' })
  })

  it('normalizes duplicate auto-approval flags to one canonical flag', () => {
    const result = resolveTuiAgentLaunchPermission({
      agent: 'codex',
      mode: 'yolo',
      agentArgs:
        '--dangerously-bypass-approvals-and-sandbox --dangerously-bypass-approvals-and-sandbox=true',
      shell: 'posix'
    })

    expect(result.agentArgs).toBe("'--dangerously-bypass-approvals-and-sandbox'")
  })

  it('normalizes alternate Codex permission flags into the canonical yolo flag', () => {
    const result = resolveTuiAgentLaunchPermission({
      agent: 'codex',
      mode: 'yolo',
      agentArgs: '--model gpt-5 --ask-for-approval=never --sandbox danger-full-access',
      shell: 'posix'
    })

    expect(result.agentArgs).toBe("'--model' 'gpt-5' '--dangerously-bypass-approvals-and-sandbox'")
  })

  it('inserts auto-approval before the end-of-options terminator', () => {
    const result = resolveTuiAgentLaunchPermission({
      agent: 'codex',
      mode: 'yolo',
      agentArgs: "--model gpt-5 -- '--literal-prompt'",
      agentEnv: {},
      shell: 'posix'
    })

    expect(result.agentArgs).toBe(
      "'--model' 'gpt-5' '--dangerously-bypass-approvals-and-sandbox' '--' '--literal-prompt'"
    )
  })

  it('removes permission flags only before the end-of-options terminator', () => {
    const result = resolveTuiAgentLaunchPermission({
      agent: 'codex',
      mode: 'manual',
      agentArgs:
        '--dangerously-bypass-approvals-and-sandbox -- --dangerously-bypass-approvals-and-sandbox',
      agentEnv: {},
      shell: 'posix'
    })

    expect(result.agentArgs).toBe(
      "'--ask-for-approval' 'on-request' '--sandbox' 'workspace-write' '--' '--dangerously-bypass-approvals-and-sandbox'"
    )
  })

  it('removes an assigned single-token permission flag in manual mode', () => {
    const result = resolveTuiAgentLaunchPermission({
      agent: 'codex',
      mode: 'manual',
      agentArgs: '--dangerously-bypass-approvals-and-sandbox=true --model gpt-5',
      shell: 'posix'
    })

    expect(result.agentArgs).toBe(
      "'--model' 'gpt-5' '--ask-for-approval' 'on-request' '--sandbox' 'workspace-write'"
    )
  })

  it('applies and removes environment-driven auto-approval per launch', () => {
    expect(
      resolveTuiAgentLaunchPermission({
        agent: 'goose',
        mode: 'yolo',
        agentArgs: '--model smart',
        agentEnv: { KEEP_ME: 'yes' },
        shell: 'posix'
      }).agentEnv
    ).toEqual({ KEEP_ME: 'yes', GOOSE_MODE: 'auto' })

    expect(
      resolveTuiAgentLaunchPermission({
        agent: 'goose',
        mode: 'manual',
        agentArgs: '--model smart',
        agentEnv: { KEEP_ME: 'yes', GOOSE_MODE: 'auto' },
        shell: 'posix'
      }).agentEnv
    ).toEqual({ KEEP_ME: 'yes' })
  })

  it('removes case-variant permission env keys on Windows', () => {
    const result = resolveTuiAgentLaunchPermission({
      agent: 'goose',
      mode: 'manual',
      agentEnv: { goose_mode: 'auto', KEEP_ME: 'yes' },
      shell: 'powershell'
    })

    expect(result.agentEnv).toEqual({ KEEP_ME: 'yes' })
  })

  it('reports whether an agent has a canonical per-launch permission mapping', () => {
    expect(supportsTuiAgentLaunchPermission('codex')).toBe(true)
    expect(supportsTuiAgentLaunchPermission('goose')).toBe(true)
    expect(supportsTuiAgentLaunchPermission('opencode')).toBe(false)
  })
})
