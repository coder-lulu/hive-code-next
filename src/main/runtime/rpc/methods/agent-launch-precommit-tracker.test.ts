import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStructuredAgentSessionForWorktree } from './structured-agent-session-create'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { StructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-host'
import { trackTerminalSpawnDispatch } from '../../../agent-launch/agent-launch-not-started'
import { AgentLaunchStructuredSessionRefusedError } from '../../../agent-launch/agent-launch-surface-factories'
import { launchFailureWithoutEffectsCode } from './agent-launch-failure-code'

afterEach(() => vi.restoreAllMocks())
function fixture() {
  const attach = vi.fn(async () => ({
    ok: false as const,
    refusal: { code: 'agent_session_operation_unknown' as const, message: 'unknown' }
  }))
  const resolve = vi.fn(async () => ({
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-one',
      workspaceKind: 'folder' as const
    },
    provider: 'codex',
    agent: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/managed/synthetic' },
    runtimeKind: 'native' as const
  }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the synthetic host implements the refused attach boundary reached by this test.
  const host = { attach } as unknown as StructuredAgentSessionHost
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: preparation only calls this resolver; attach is independently refused by the synthetic host.
  const runtime = {
    resolveStructuredAgentSessionCreateIntent: resolve
  } as unknown as OrcaRuntimeService
  const tracker = trackTerminalSpawnDispatch()
  const refused = vi.fn((refusal, cause) =>
    tracker.rethrow(
      new AgentLaunchStructuredSessionRefusedError(refusal.code, refusal.message, { cause })
    )
  )
  const create = () =>
    createStructuredAgentSessionForWorktree({
      runtime,
      ensureHost: async () => host,
      caller: { callerKey: 'synthetic:host' },
      envelope: {
        sessionId: 'synthetic-session',
        clientOperationId: `1800000000000-${'a'.repeat(32)}`,
        expectedRuntimeFence: null,
        payloadFingerprint: ''
      },
      worktree: 'id:workspace-one',
      agent: 'codex',
      activate: false,
      onPrepareRefused: refused
    })
  return { attach, resolve, tracker, refused, create }
}
describe('the actual structured preparation boundary', () => {
  it('tracks a refused prepare and preserves its original cause without invoking attach', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fixture()
    const cause = new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
    f.resolve.mockRejectedValueOnce(cause)
    const failure = await f.create().catch((error) => error)
    expect(failure).toBeInstanceOf(AgentLaunchStructuredSessionRefusedError)
    expect(failure.cause).toBe(cause)
    expect(f.attach).not.toHaveBeenCalled()
    expect(launchFailureWithoutEffectsCode(failure, 'existing', f.tracker)).toBe(
      'structured_agent_session_unsupported'
    )
    expect(launchFailureWithoutEffectsCode(failure, 'create-worktree', f.tracker)).toBeNull()
  })
  it('does not track an attach refusal, even with the same refusal code', async () => {
    const f = fixture()
    const result = await f.create()
    expect(result.ok).toBe(false)
    expect(f.refused).not.toHaveBeenCalled()
    expect(f.attach).toHaveBeenCalledOnce()
    const failure = new AgentLaunchStructuredSessionRefusedError(
      'structured_agent_session_unsupported',
      'refused after attach'
    )
    expect(launchFailureWithoutEffectsCode(failure, 'existing', f.tracker)).toBeNull()
  })
  it('does not mark a thrown attach failure as prelaunch proof', async () => {
    const f = fixture()
    const failure = new Error('structured_agent_session_unsupported')
    f.attach.mockRejectedValueOnce(failure)
    await expect(f.create()).rejects.toBe(failure)
    expect(f.refused).not.toHaveBeenCalled()
    expect(launchFailureWithoutEffectsCode(failure, 'existing', f.tracker)).toBeNull()
  })
})
