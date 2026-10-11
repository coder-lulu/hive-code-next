import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProviderHandle } from '../../shared/agent-session-provider-handle-encoding'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { reserveRequestFor } from '../native-chat/agent-session-wire/structured-agent-session-attach'
import { teamToolFixture } from '../tasks/hive-team-task-tools.test-fixture'
import { openTestAgentSessionRecordStore } from './agent-session-record-store-test-harness'
import { prepareRuntimeTeamTaskTools } from './structured-team-task-tools'

const databases: string[] = []
afterEach(() => {
  for (const directory of databases.splice(0)) {
    closeTestJournalHostDatabase(directory)
  }
})

async function fixture() {
  const business = await teamToolFixture()
  const directory = join(business.directory, 'record-store')
  databases.push(directory)
  const store = await openTestAgentSessionRecordStore(directory)
  const sessionId = randomUUID()
  const now = Date.now()
  const request = reserveRequestFor({
    sessionId,
    params: {
      envelope: {
        sessionId,
        clientOperationId: `${now}-${randomUUID().replaceAll('-', '')}`,
        expectedRuntimeFence: null,
        payloadFingerprint: 'team-tool-store-regression'
      },
      location: {
        executionHostId: 'local',
        wslDistro: null,
        workspaceId: 'workspace-test',
        workspaceKind: 'folder'
      },
      provider: 'codex',
      agent: 'codex',
      accountHome: { variable: 'CODEX_HOME', path: join(directory, 'account') },
      runtimeKind: 'native'
    },
    authority: {
      spawnToken: 'spawn-owned',
      claimKeyId: 'claim-owned',
      handoffOperationId: 'reserve-operation-owned',
      probe: { outcome: 'reservation-unused' }
    },
    callerKey: 'native-host',
    fingerprint: 'team-tool-store-regression',
    now
  })
  const reserved = await store.reserveOwner(request)
  const input: StructuredAgentSessionAcquireInput = {
    identity: {
      sessionId,
      workspaceId: request.location.workspaceId,
      hostId: 'local',
      agent: 'codex',
      providerHandle: null
    },
    fence: reserved.record.lease.runtimeFence,
    spawnToken: 'spawn-owned'
  }
  const provider = vi.fn(async (scope: Parameters<typeof business.factory>[0]) =>
    business.factory(scope)
  )
  const prepare = async () => {
    const tools = await prepareRuntimeTeamTaskTools({ input, store, provider })
    if (!tools) {
      throw new Error('Native Codex reservation did not receive team tools')
    }
    return tools
  }
  const commitProcess = () =>
    store.commitProcessIdentity({
      sessionId,
      fence: input.fence,
      process: {
        hostId: store.hostId,
        pid: 4242,
        processStartTimeMs: now,
        spawnToken: input.spawnToken
      },
      now: Date.now()
    })
  const prove = () =>
    store.proveOwner({
      sessionId,
      fence: input.fence,
      link: {
        linkId: 'proved-thread',
        handle: codexProviderHandle(business.threadId),
        origin: 'created',
        mintedAtFence: input.fence,
        observedAt: Date.now()
      },
      now: Date.now()
    })
  const revoke = () =>
    store.transitionHandoff(sessionId, (record) => ({
      ...record,
      lease: { ...record.lease, handoffStage: 'recovering' }
    }))
  return { ...business, store, input, provider, prepare, commitProcess, prove, revoke }
}

describe('team tools with the durable native acquisition lifecycle', () => {
  it('binds the catalog while reserved and admits business effects only after owner proof', async () => {
    const f = await fixture()
    expect(f.store.getRecord(f.input.identity.sessionId)?.lease).toMatchObject({
      claimStatus: 'reserved',
      handoffStage: 'new-owner-proving',
      ownerProcess: null,
      handoffOperationId: 'reserve-operation-owned'
    })
    const tools = await f.prepare()
    expect(tools).not.toBeNull()
    expect(await tools.bindThread(f.threadId, false)).toBe(true)
    await expect(tools.call(f.call, () => undefined)).rejects.toThrow('FORBIDDEN')
    await f.commitProcess()
    await expect(tools.call(f.call, () => undefined)).rejects.toThrow('FORBIDDEN')
    expect(f.listCompanies).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(f.start).not.toHaveBeenCalled()

    await f.prove()
    expect(await tools.call(f.call, () => undefined)).toMatchObject({ success: true })
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.start).toHaveBeenCalledTimes(1)
  })

  it('rechecks the live lease after an awaited Case creation before starting execution', async () => {
    const f = await fixture()
    const tools = await f.prepare()
    await tools.bindThread(f.threadId, false)
    await f.commitProcess()
    await f.prove()
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    f.create.mockImplementationOnce(async (input) => {
      entered.resolve()
      await resume.promise
      return { ...structuredClone(f.view), title: input.title, requirement: input.requirement }
    })
    const pending = tools.call(f.call, () => undefined)
    const rejected = expect(pending).rejects.toThrow('FORBIDDEN')
    await entered.promise
    await f.revoke()
    resume.resolve()
    await rejected
    expect(f.create).toHaveBeenCalledTimes(1)
    expect(f.start).not.toHaveBeenCalled()
  })

  it.each(['operation', 'spawn', 'fence'] as const)(
    'refuses catalog binding after the persisted reservation loses its %s identity',
    async (change) => {
      const f = await fixture()
      const tools = await f.prepare()
      await f.store.transitionHandoff(f.input.identity.sessionId, (record) => ({
        ...record,
        lease: {
          ...record.lease,
          ...(change === 'operation' ? { handoffOperationId: null } : {}),
          ...(change === 'spawn' ? { reservedSpawnToken: 'other-owner' } : {}),
          ...(change === 'fence' ? { runtimeFence: record.lease.runtimeFence + 1 } : {})
        }
      }))
      await expect(tools.bindThread(f.threadId, false)).rejects.toThrow('FORBIDDEN')
      expect(f.create).not.toHaveBeenCalled()
      expect(f.start).not.toHaveBeenCalled()
    }
  )
})
