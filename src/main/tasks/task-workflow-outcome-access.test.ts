import { describe, expect, it, vi } from 'vitest'
import { readPersistedTestAgentSessionStoreText } from '../runtime/agent-session-record-store-test-harness'
import { TaskExecutionHost } from './task-execution-host'
import { outcomeAccessFixture } from './task-workflow-outcome-access.test-fixture'

describe('original host authority for immutable workflow outcome reads', () => {
  it('uses observe authority and reads stopped facts without launching, stopping or changing the record', async () => {
    const f = await outcomeAccessFixture()
    const before = await readPersistedTestAgentSessionStoreText(f.root)
    expect(await f.host.workflowOutcome(f.query, f.caller)).toEqual(f.asset)
    expect(await f.host.workflowCommands(f.commandQuery, f.caller)).toEqual(f.commands)
    expect(f.deps.authorize).toHaveBeenCalledWith(f.caller, f.command, 'observe')
    expect(f.deps.launch).not.toHaveBeenCalled()
    expect(f.deps.stop).not.toHaveBeenCalled()
    expect(f.deps.collect).not.toHaveBeenCalled()
    expect(await readPersistedTestAgentSessionStoreText(f.root)).toBe(before)
  })
  it('requires the original operation caller before reading either asset', async () => {
    const f = await outcomeAccessFixture()
    const foreign = { operationCallerKey: 'service:foreign' }
    await expect(f.host.workflowOutcome(f.query, foreign)).rejects.toThrow('EXECUTION_NOT_FOUND')
    await expect(f.host.workflowCommands(f.commandQuery, foreign)).rejects.toThrow(
      'EXECUTION_NOT_FOUND'
    )
    expect(f.deps.authorize).not.toHaveBeenCalled()
    expect(f.deps.workflowOutcomes!.read).not.toHaveBeenCalled()
    expect(f.deps.workflowOutcomes!.readCommands).not.toHaveBeenCalled()
  })
  it.each(['ownershipEpoch', 'commandFingerprint'] as const)(
    'rejects a mismatched %s',
    async (key) => {
      const f = await outcomeAccessFixture()
      const query = { ...f.query, [key]: key === 'ownershipEpoch' ? 999 : 'f'.repeat(64) }
      await expect(f.host.workflowOutcome(query, f.caller)).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      expect(f.deps.workflowOutcomes!.read).not.toHaveBeenCalled()
    }
  )
  it('does not reconcile an unsettled record in order to serve a read', async () => {
    const f = await outcomeAccessFixture()
    vi.spyOn(f.store.tasks, 'get').mockReturnValue(f.beforeStop)
    await expect(f.host.workflowOutcome(f.query, f.caller)).rejects.toThrow('OUTCOME_UNKNOWN')
    await expect(f.host.workflowCommands(f.commandQuery, f.caller)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    expect(f.deps.workflowOutcomes!.read).not.toHaveBeenCalled()
    expect(f.deps.stop).not.toHaveBeenCalled()
    expect(f.deps.collect).not.toHaveBeenCalled()
  })
  it.each(['revokeOwner', 'revokeGrant', 'expire'] as const)(
    'rejects %s through the existing live grant',
    async (change) => {
      const f = await outcomeAccessFixture()
      f[change]()
      await expect(f.host.workflowOutcome(f.query, f.caller)).rejects.toThrow('FORBIDDEN')
      await expect(f.host.workflowCommands(f.commandQuery, f.caller)).rejects.toThrow('FORBIDDEN')
      expect(f.deps.workflowOutcomes!.read).not.toHaveBeenCalled()
      expect(f.deps.workflowOutcomes!.readCommands).not.toHaveBeenCalled()
    }
  )
  it.each(['revokeOwner', 'revokeGrant', 'revokeCaller', 'expire'] as const)(
    'rejects %s after outcome I/O even if a port omits its final check',
    async (change) => {
      const f = await outcomeAccessFixture()
      vi.mocked(f.deps.workflowOutcomes!.read).mockImplementationOnce(async (_record, guard) => {
        guard()
        await Promise.resolve()
        f[change]()
        return f.asset
      })
      await expect(f.host.workflowOutcome(f.query, f.caller)).rejects.toThrow('FORBIDDEN')
    }
  )
  it.each(['revokeOwner', 'revokeCaller', 'expire'] as const)(
    'rejects %s after commands I/O',
    async (change) => {
      const f = await outcomeAccessFixture()
      vi.mocked(f.deps.workflowOutcomes!.readCommands).mockImplementationOnce(
        async (_record, _ref, guard) => {
          guard()
          await Promise.resolve()
          f[change]()
          return f.commands
        }
      )
      await expect(f.host.workflowCommands(f.commandQuery, f.caller)).rejects.toThrow('FORBIDDEN')
    }
  )
  it('does not return a result when its original record disappeared during I/O', async () => {
    const f = await outcomeAccessFixture()
    vi.mocked(f.deps.workflowOutcomes!.read).mockImplementationOnce(async () => {
      vi.spyOn(f.store.tasks, 'get').mockReturnValue(null)
      return f.asset
    })
    await expect(f.host.workflowOutcome(f.query, f.caller)).rejects.toThrow('EXECUTION_NOT_FOUND')
  })
  it('keeps record lookup fixed while checking live authority for every I/O boundary', async () => {
    const f = await outcomeAccessFixture()
    const get = vi.spyOn(f.store.tasks, 'get'),
      callerGuard = vi.spyOn(f.caller, 'assertCurrent')
    vi.mocked(f.deps.workflowOutcomes!.read).mockImplementationOnce(async (_record, guard) => {
      for (let i = 0; i < 100; i += 1) {
        guard()
        await Promise.resolve()
      }
      return f.asset
    })
    expect(await f.host.workflowOutcome(f.query, f.caller)).toEqual(f.asset)
    expect(get).toHaveBeenCalledTimes(2)
    expect(callerGuard.mock.calls.length).toBeGreaterThanOrEqual(100)
  })
  it('rejects a replaced producer after I/O while preserving the same terminal receipt', async () => {
    const f = await outcomeAccessFixture(),
      changed = structuredClone(f.record)
    changed.workspace.workspaceId = 'workspace:replaced'
    changed.launch!.worktreeId = changed.workspace.workspaceId
    vi.mocked(f.deps.workflowOutcomes!.read).mockImplementationOnce(async () => {
      vi.spyOn(f.store.tasks, 'get').mockReturnValue(changed)
      return f.asset
    })
    await expect(f.host.workflowOutcome(f.query, f.caller)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('reports an absent isolated outcome port as unavailable', async () => {
    const f = await outcomeAccessFixture()
    delete f.deps.workflowOutcomes
    const host = new TaskExecutionHost(f.deps)
    await expect(host.workflowOutcome(f.query, f.caller)).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    await expect(host.workflowCommands(f.commandQuery, f.caller)).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
  })
  it.each(['path', 'assertCurrent', 'stopped', 'ownerProof'])(
    'rejects caller-supplied %s instead of treating metadata as authority',
    async (field) => {
      const f = await outcomeAccessFixture()
      await expect(f.host.workflowOutcome({ ...f.query, [field]: true }, f.caller)).rejects.toThrow(
        'INVALID_REQUEST'
      )
      expect(f.deps.authorize).not.toHaveBeenCalled()
    }
  )
  it.each(['../private', 'artifact:short', `artifact:${'a'.repeat(64)}\n`])(
    'rejects a noncanonical command reference %s',
    async (artifactRef) => {
      const f = await outcomeAccessFixture()
      await expect(
        f.host.workflowCommands({ ...f.commandQuery, artifactRef }, f.caller)
      ).rejects.toThrow('INVALID_REQUEST')
      expect(f.deps.workflowOutcomes!.readCommands).not.toHaveBeenCalled()
    }
  )
})
