import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { NativeTeamTaskToolSession } from '../../shared/hive-team-task-tools'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { prepareRuntimeTeamTaskTools } from './structured-team-task-tools'

function fixture() {
  const record: AgentSessionRecord = {
    schemaVersion: 2,
    sessionId: 'codex_tools_test',
    provider: 'codex',
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-a',
      workspaceKind: 'folder'
    },
    accountHome: { variable: 'CODEX_HOME', path: '/account-home' },
    providerHandleChain: [],
    createdAt: 1,
    updatedAt: 1,
    lease: {
      sessionId: 'codex_tools_test',
      runtimeKind: 'native',
      runtimeFence: 3,
      handoffStage: 'new-owner-proving',
      provenHandleLinkId: null,
      ownerProcess: null,
      reservedSpawnToken: 'spawn-a',
      leaseDeadlineAt: Date.now() + 60_000,
      lastRenewedAt: Date.now(),
      handoffOperationId: 'operation-a',
      journalCheckpoint: null,
      claimKeyId: 'key-a',
      claimStatus: 'reserved',
      unreconciled: false,
      deathEvidence: null
    }
  }
  let current: AgentSessionRecord | null = record
  const store = { hostId: 'local', readOnly: false, getRecord: vi.fn(() => current) }
  const tools: NativeTeamTaskToolSession = {
    definitions: [],
    bindThread: vi.fn(async () => true),
    call: vi.fn<NativeTeamTaskToolSession['call']>(async (_input, guard) => {
      guard()
      return { success: true, value: { state: 'no_record' } }
    })
  }
  let guard: (() => void) | undefined
  const provider = vi.fn(async (input: { assertCurrent(): void }) => {
    guard = input.assertCurrent
    guard()
    return tools
  })
  const input: StructuredAgentSessionAcquireInput = {
    identity: {
      sessionId: record.sessionId,
      workspaceId: 'workspace-a',
      hostId: 'local',
      agent: 'codex',
      providerHandle: null
    },
    fence: 3,
    spawnToken: 'spawn-a'
  }
  const prepare = () => prepareRuntimeTeamTaskTools({ input, store, provider })
  return {
    record,
    store,
    input,
    provider,
    tools,
    prepare,
    guard: () => guard?.(),
    remove: () => {
      current = null
    }
  }
}

describe('native conversation team-tool bootstrap authority', () => {
  it('passes only the original host workspace selector and guard', async () => {
    const f = fixture()
    const prepared = await f.prepare()
    expect(prepared?.definitions).toBe(f.tools.definitions)
    expect(f.provider).toHaveBeenCalledWith({
      sessionId: 'codex_tools_test',
      workspaceSelector: 'id:workspace-a',
      assertCurrent: expect.any(Function)
    })
    f.record.lease.claimStatus = 'live'
    f.record.lease.handoffStage = null
    f.record.lease.handoffOperationId = null
    f.record.lease.reservedSpawnToken = null
    f.record.lease.ownerProcess = {
      hostId: 'local',
      pid: 42,
      processStartTimeMs: 1,
      spawnToken: 'spawn-a'
    }
    expect(() => f.guard()).not.toThrow()
  })

  it.each([
    'workspace',
    'fence',
    'spawn',
    'readonly',
    'removed',
    'provider',
    'remote',
    'expiry',
    'account',
    'handoff',
    'operation',
    'reservation-stage',
    'live-owner',
    'unreconciled',
    'released'
  ])('revokes the captured guard after %s changes', async (change) => {
    const f = fixture()
    await f.prepare()
    if (change === 'workspace') {
      f.record.location.workspaceId = 'workspace-b'
    }
    if (change === 'fence') {
      f.record.lease.runtimeFence++
    }
    if (change === 'spawn') {
      f.record.lease.reservedSpawnToken = 'spawn-b'
    }
    if (change === 'readonly') {
      f.store.readOnly = true
    }
    if (change === 'removed') {
      f.remove()
    }
    if (change === 'provider') {
      f.record.provider = 'claude'
    }
    if (change === 'remote') {
      f.record.location.executionHostId = 'ssh:remote'
    }
    if (change === 'expiry') {
      f.record.lease.leaseDeadlineAt = 0
    }
    if (change === 'account') {
      f.record.accountHome.path = '/other-account'
    }
    if (change === 'handoff') {
      f.record.lease.handoffStage = 'recovering'
    }
    if (change === 'operation') {
      f.record.lease.handoffOperationId = 'operation-b'
    }
    if (change === 'reservation-stage') {
      f.record.lease.handoffStage = null
    }
    if (change === 'live-owner') {
      f.record.lease.claimStatus = 'live'
      f.record.lease.handoffStage = null
    }
    if (change === 'unreconciled') {
      f.record.lease.unreconciled = true
    }
    if (change === 'released') {
      f.record.lease.claimStatus = 'released'
    }
    expect(() => f.guard()).toThrow('FORBIDDEN')
  })

  it.each(['remote', 'wsl', 'provider', 'task'])(
    'does not prepare tools for a %s session',
    async (change) => {
      const f = fixture()
      if (change === 'remote') {
        f.record.location.executionHostId = 'ssh:remote'
      }
      if (change === 'wsl') {
        f.record.location.wslDistro = 'Ubuntu'
      }
      if (change === 'provider') {
        f.input.identity.agent = 'claude'
      }
      if (change === 'task') {
        Object.assign(f.record, { taskSource: {} })
      }
      expect(await f.prepare()).toBeNull()
      expect(f.provider).not.toHaveBeenCalled()
    }
  )

  it('denies a substituted caller workspace before creating the provider', async () => {
    const f = fixture()
    f.input.identity.workspaceId = 'workspace-b'
    await expect(f.prepare()).rejects.toThrow('FORBIDDEN')
    expect(f.provider).not.toHaveBeenCalled()
  })

  it('rechecks ownership after an asynchronous provider preparation', async () => {
    const f = fixture()
    f.provider.mockImplementationOnce(async () => {
      f.record.lease.runtimeFence++
      return f.tools
    })
    await expect(f.prepare()).rejects.toThrow('FORBIDDEN')
  })
})
