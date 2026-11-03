import { describe, expect, it } from 'vitest'
import { resolveTuiAgentLaunchPermission } from '../tui-agent-permissions'
import { sleepingAgentLaunchConfigSchema } from '../workspace-session-sleeping-agents'
import { CreateAgentSessionParams, EnsureAgentSessionParams } from './agent-session-params'

const create = {
  clientOperationId: '1761840000000-0123456789abcdef0123456789abcdef',
  worktree: 'id:worktree-1',
  agent: 'codex'
}
const ensure = {
  kind: 'explicit',
  worktree: 'id:worktree-1',
  agent: 'codex',
  providerSession: { key: 'session_id', id: 'provider-session-1' }
}

describe('current explicit terminal launch permissions', () => {
  it('preserves saved resume metadata together with explicit permissions', () => {
    expect(
      EnsureAgentSessionParams.parse({
        ...ensure,
        resumeOrigin: 'saved',
        agentPermissionMode: 'manual'
      })
    ).toEqual({ ...ensure, resumeOrigin: 'saved', agentPermissionMode: 'manual' })
  })
  it.each([
    { resumeOrigin: 'automatic' },
    { resumeOrigin: 'saved', hostAuthority: true },
    { resumeOrigin: 'saved', agentSessionClaim: 'untrusted' },
    { resumeOrigin: 'saved', agentPermissionMode: 'full-access' }
  ])('rejects invalid saved metadata and caller authority: %j', (extra) => {
    expect(EnsureAgentSessionParams.safeParse({ ...ensure, ...extra }).success).toBe(false)
  })
  it('admits Auto on a valid current create', () => {
    expect(CreateAgentSessionParams.safeParse(create).success).toBe(true)
    const parsed = CreateAgentSessionParams.safeParse({ ...create, agentPermissionMode: 'auto' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.agentPermissionMode).toBe('auto')
    }
  })
  it('admits Auto on a valid current explicit resume', () => {
    expect(EnsureAgentSessionParams.safeParse(ensure).success).toBe(true)
    const parsed = EnsureAgentSessionParams.safeParse({ ...ensure, agentPermissionMode: 'auto' })
    expect(parsed.success).toBe(true)
    if (parsed.success && parsed.data.kind === 'explicit') {
      expect(parsed.data.agentPermissionMode).toBe('auto')
    }
  })
  it('retains Auto in a recorded current sleeping launch recipe', () => {
    const recipe = {
      agentArgs: '--profile review',
      agentEnv: {},
      hostDefaultsAuthoritative: true,
      agentPermissionMode: 'auto'
    }
    expect(sleepingAgentLaunchConfigSchema.parse(recipe)).toEqual(recipe)
  })
  it.each(['manual', 'yolo'] as const)(
    'preserves the current explicit %s mode',
    (agentPermissionMode) => {
      expect(
        CreateAgentSessionParams.parse({ ...create, agentPermissionMode }).agentPermissionMode
      ).toBe(agentPermissionMode)
    }
  )
  it('does not convert unsupported Auto into another permission mode', () => {
    expect(() =>
      resolveTuiAgentLaunchPermission({ agent: 'gemini', mode: 'auto', shell: 'posix' })
    ).toThrow('Automatic approval is unavailable for this agent')
  })
})
