import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import { agentSessionRefusalError } from '../../../shared/agent-session-wire-refusals'
import { CodexStructuredSessionAdapter } from '../../codex/codex-structured-session-adapter'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore
} from '../../runtime/agent-session-record-store-test-harness'
import { taskStructuredFixture } from '../../tasks/task-structured-reservation.test-fixture'
import { taskWorkspace, TASK_TEST_NOW } from '../../tasks/task-execution.test-fixture'
import {
  createTrackedJournalOpener,
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../agent-session-journal/journal-host-database-test-support'
import {
  AgentSessionPreSpawnError,
  type StructuredAgentSessionAdapter
} from './structured-agent-session-adapter'
import { acquireOwner } from './structured-agent-session-acquisition'
import {
  attachFingerprintFields,
  reserveRequestFor,
  type AgentSessionAttachParams
} from './structured-agent-session-attach'
import { performAttach, type AttachFlowInput } from './structured-agent-session-attach-flow'
import { openTestAttachConversation } from './structured-agent-session-attach-test-conversation'
import { recordingStructuredAgentSessionLogger } from './structured-agent-session-logger-test-support'

const logs = resolve(
  'logs/paperclip-development/p3/task-session-binding/verification/acquisition/tmp'
)
const journals = createTrackedJournalOpener()
const codexAdapters = new Set<CodexStructuredSessionAdapter>()
let directory: string | undefined
afterEach(async () => {
  for (const adapter of codexAdapters) {
    await adapter.closeAll()
  }
  codexAdapters.clear()
  await journals.closeAll()
  vi.restoreAllMocks()
  if (directory) {
    await rm(directory, { recursive: true, force: true })
  }
  directory = undefined
})

async function fixture() {
  await mkdir(logs, { recursive: true })
  directory = await mkdtemp(join(logs, 'attach-'))
  const task = taskStructuredFixture(taskWorkspace(directory))
  const store = await openTestAgentSessionRecordStore(directory)
  await store.tasks.admit(task.admission)
  await store.tasks.beginDispatch(task.command, TASK_TEST_NOW, task.validate)
  await store.admitOperation({
    callerKey: task.outer.callerKey,
    operationId: task.outer.operationId,
    fingerprint: task.outer.fingerprint,
    now: TASK_TEST_NOW
  })
  await store.claimOperation(task.outer)
  const params: AgentSessionAttachParams = {
    envelope: {
      sessionId: task.request.sessionId,
      clientOperationId: task.request.operation.operationId,
      expectedRuntimeFence: null,
      payloadFingerprint: ''
    },
    location: task.request.location,
    provider: 'codex',
    agent: 'codex',
    accountHome: task.request.accountHome,
    runtimeKind: 'native',
    taskOrigin: task.origin
  }
  params.envelope.payloadFingerprint = computeAgentSessionPayloadFingerprint({
    method: 'agentSession.attach',
    sessionId: params.envelope.sessionId,
    fields: attachFingerprintFields(params)
  })
  const adapter: StructuredAgentSessionAdapter = {
    acquire: vi.fn<StructuredAgentSessionAdapter['acquire']>(async ({ fence, spawnToken }) => ({
      process: { hostId: 'local', pid: 4242, processStartTimeMs: TASK_TEST_NOW, spawnToken },
      link: {
        linkId: 'task-test-link',
        handle: { provider: 'codex', threadId: 'task-test-thread' },
        origin: 'created',
        mintedAtFence: fence,
        observedAt: TASK_TEST_NOW
      }
    })),
    dispatch: vi.fn(),
    cancelTurn: vi.fn(),
    answerPrompt: vi.fn(),
    setOption: vi.fn(),
    releaseAcquisition: vi.fn(async () => true)
  }
  const input: AttachFlowInput = {
    logger: recordingStructuredAgentSessionLogger().logger,
    store,
    adapter,
    params,
    callerKey: task.origin.operationCallerKey,
    authority: {
      spawnToken: task.request.spawnToken,
      claimKeyId: task.request.claimKeyId,
      handoffOperationId: params.envelope.clientOperationId,
      probe: task.request.probe
    },
    now: () => TASK_TEST_NOW,
    openConversation: openTestAttachConversation(openTestJournalHostDatabase(directory)),
    onAttached: (attached) => {
      journals.track(attached.journal)
    }
  }
  const cancel = () =>
    store.tasks.requestCancellation(task.command, 'cancel:attach', TASK_TEST_NOW, () => undefined)
  return { ...task, store, params, adapter, input, cancel }
}

async function reserve(f: Awaited<ReturnType<typeof fixture>>) {
  return f.store.reserveOwner(
    reserveRequestFor({
      sessionId: f.params.envelope.sessionId,
      params: f.params,
      authority: f.input.authority,
      callerKey: f.input.callerKey,
      fingerprint: f.params.envelope.payloadFingerprint,
      now: TASK_TEST_NOW
    })
  )
}

describe('original Task authority at structured acquisition', () => {
  it('refuses a queued revocation after the final helper returns to acquireOwner', async () => {
    const f = await fixture()
    const reserved = await reserve(f)
    let revoked = false
    f.validate.mockImplementation(() => {
      if (revoked) {
        throw new Error('grant-revoked-after-helper')
      }
    })
    const check = f.store.assertTaskAcquisition.bind(f.store)
    vi.spyOn(f.store, 'assertTaskAcquisition').mockImplementation((request, record) =>
      check(request, record).then(() => {
        queueMicrotask(() =>
          queueMicrotask(() => {
            revoked = true
          })
        )
      })
    )
    await expect(acquireOwner(f.input, reserved.record)).rejects.toBeInstanceOf(
      AgentSessionPreSpawnError
    )
    expect(revoked).toBe(true)
    expect(f.adapter.acquire).not.toHaveBeenCalled()
  })

  it.each(['same-store-cancel', 'other-store-cancel', 'grant-revocation'] as const)(
    'rechecks the original Task at actual Codex open after launch resolution: %s',
    async (change) => {
      const f = await fixture()
      const reserved = await reserve(f)
      const open = vi.fn(async () => {
        throw new AgentSessionPreSpawnError(new Error('test-open-without-process'))
      })
      const adapter = new CodexStructuredSessionAdapter({
        isWindowsProcessStartTimeAvailable: () => true,
        resolveLaunch: async () => {
          if (change === 'grant-revocation') {
            f.validate.mockImplementation(() => {
              throw new Error('resolver-grant-revoked')
            })
          } else if (change === 'other-store-cancel') {
            const other = await openTestAgentSessionRecordStore(directory!)
            await other.tasks.requestCancellation(
              f.command,
              'cancel:resolver-other',
              TASK_TEST_NOW,
              () => undefined
            )
          } else {
            await f.cancel()
          }
          return {
            command: 'test-never-executed',
            args: [],
            cwd: f.task.workspace.executionPath,
            codexHome: f.params.accountHome.path,
            resumeThreadId: null
          }
        },
        openConnection: open
      })
      codexAdapters.add(adapter)
      f.input.adapter = adapter
      await expect(acquireOwner(f.input, reserved.record)).rejects.toBeInstanceOf(
        AgentSessionPreSpawnError
      )
      expect(open).not.toHaveBeenCalled()
      expect(f.store.getRecord(f.request.sessionId)?.lease).toMatchObject({
        ownerProcess: null,
        deathEvidence: null
      })
    }
  )

  it('rechecks synchronous grant in the Codex frame after its fresh source guard awaited', async () => {
    const f = await fixture()
    const reserved = await reserve(f)
    let revoked = false
    let checks = 0
    f.validate.mockImplementation(() => {
      if (revoked) {
        throw new Error('spawn-grant-revoked-after-prepare')
      }
    })
    const check = f.store.assertTaskAcquisition.bind(f.store)
    vi.spyOn(f.store, 'assertTaskAcquisition').mockImplementation((request, record) =>
      check(request, record).then(() => {
        checks += 1
        if (checks === 2) {
          queueMicrotask(() =>
            queueMicrotask(() => {
              revoked = true
            })
          )
        }
      })
    )
    const open = vi.fn(async () => {
      throw new AgentSessionPreSpawnError(new Error('test-open-without-process'))
    })
    const adapter = new CodexStructuredSessionAdapter({
      isWindowsProcessStartTimeAvailable: () => true,
      resolveLaunch: async () => ({
        command: 'test-never-executed',
        args: [],
        cwd: f.task.workspace.executionPath,
        codexHome: f.params.accountHome.path,
        resumeThreadId: null
      }),
      openConnection: open
    })
    codexAdapters.add(adapter)
    f.input.adapter = adapter
    await expect(acquireOwner(f.input, reserved.record)).rejects.toBeInstanceOf(
      AgentSessionPreSpawnError
    )
    expect(checks).toBe(2)
    expect(revoked).toBe(true)
    expect(open).not.toHaveBeenCalled()
  })

  it('commits Task, session source and inner operation before any provider child is acquired', async () => {
    const f = await fixture()
    const acquire = vi.mocked(f.adapter.acquire).getMockImplementation()
    if (!acquire) {
      throw new Error('The test provider acquire implementation is missing.')
    }
    vi.mocked(f.adapter.acquire).mockImplementation(async (request) => {
      const persisted = await readPersistedTestAgentSessionStore(directory!)
      const binding = persisted.taskExecutions[f.key].structuredBinding
      expect(binding).toMatchObject({
        source: f.origin.source,
        sessionId: request.identity.sessionId,
        runtimeFence: request.fence,
        spawnToken: request.spawnToken,
        accountHome: f.params.accountHome
      })
      expect(persisted.records[f.request.sessionId].taskSource).toEqual(f.origin.source)
      expect(
        Object.values(persisted.operations).find(
          (row) => row.operationId === f.request.operation.operationId
        )?.outcome.status
      ).toBe('pending')
      return acquire(request)
    })
    expect(await performAttach(f.input)).toMatchObject({ ok: true })
    expect(f.adapter.acquire).toHaveBeenCalledOnce()
    const reopened = await openTestAgentSessionRecordStore(directory!)
    expect(reopened.tasks.get(f.command)?.structuredBinding?.source).toEqual(f.origin.source)
    expect(reopened.getRecord(f.request.sessionId)?.taskSource).toEqual(f.origin.source)
  })

  it('refuses cancellation committed while the reservation reply was awaited', async () => {
    const f = await fixture()
    const reserve = f.store.reserveOwner.bind(f.store)
    vi.spyOn(f.store, 'reserveOwner').mockImplementation(async (request) => {
      const reserved = await reserve(request)
      await f.cancel()
      return reserved
    })
    expect(await performAttach(f.input)).toMatchObject({ ok: false })
    expect(f.adapter.acquire).not.toHaveBeenCalled()
    expect(f.adapter.releaseAcquisition).not.toHaveBeenCalled()
    expect(f.store.tasks.get(f.command)?.cancellationKey).toBe('cancel:attach')
  })

  it('rechecks the original grant after the reservation write', async () => {
    const f = await fixture()
    const reserve = f.store.reserveOwner.bind(f.store)
    vi.spyOn(f.store, 'reserveOwner').mockImplementation(async (request) => {
      const reserved = await reserve(request)
      f.validate.mockImplementation(() => {
        throw agentSessionRefusalError('agent_session_operation_invalid', {
          reason: 'requestMalformed'
        })
      })
      return reserved
    })
    expect(await performAttach(f.input)).toMatchObject({ ok: false })
    expect(f.adapter.acquire).not.toHaveBeenCalled()
  })

  it('rechecks Task cancellation after an asynchronous acquisition callback', async () => {
    const f = await fixture()
    f.input.onAcquiring = async () => {
      closeTestJournalHostDatabase(directory!)
      const other = await openTestAgentSessionRecordStore(directory!)
      f.store = other
      f.input.store = other
      await other.tasks.requestCancellation(
        f.command,
        'cancel:other',
        TASK_TEST_NOW,
        () => undefined
      )
    }
    await expect(performAttach(f.input)).rejects.toThrow(
      'agent session acquisition failure settlement failed'
    )
    expect(f.adapter.acquire).not.toHaveBeenCalled()
    expect(f.store.tasks.get(f.command)?.cancellationKey).toBe('cancel:other')
    expect(f.store.getRecord(f.request.sessionId)?.lease).toMatchObject({
      ownerProcess: null,
      unreconciled: true,
      deathEvidence: null
    })
  })

  it('checks synchronous current authority again after the final file transaction awaited', async () => {
    const f = await fixture()
    const validate = f.store.assertTaskAcquisition.bind(f.store)
    let checks = 0
    vi.spyOn(f.store, 'assertTaskAcquisition').mockImplementation(async (request, record) => {
      await validate(request, record)
      checks += 1
      if (checks === 2) {
        f.validate.mockImplementation(() => {
          throw agentSessionRefusalError('agent_session_operation_invalid', {
            reason: 'requestMalformed'
          })
        })
      }
    })
    expect(await performAttach(f.input)).toMatchObject({ ok: false })
    expect(checks).toBe(2)
    expect(f.adapter.acquire).not.toHaveBeenCalled()
  })

  it('refuses Task cancellation while provider history is awaited', async () => {
    const f = await fixture()
    f.adapter.providerHistoryWindow = vi.fn(async () => {
      await f.cancel()
      return { items: [], boundaryConsistent: true, turnInFlight: false }
    })
    expect(await performAttach(f.input)).toMatchObject({ ok: false })
    expect(f.adapter.providerHistoryWindow).toHaveBeenCalledOnce()
    expect(f.adapter.acquire).not.toHaveBeenCalled()
  })

  it('refuses a stripped source on disk before acquisition', async () => {
    const f = await fixture()
    const reserve = f.store.reserveOwner.bind(f.store)
    vi.spyOn(f.store, 'reserveOwner').mockImplementation(async (request) => {
      const reserved = await reserve(request)
      await editPersistedTestAgentSessionStore(directory!, (state) => {
        delete state.records[f.request.sessionId].taskSource
      })
      return reserved
    })
    await expect(performAttach(f.input)).rejects.toThrow(
      'agent session acquisition failure settlement failed'
    )
    expect(f.adapter.acquire).not.toHaveBeenCalled()
  })

  it('cannot submit a Task inner operation without the host origin', async () => {
    const f = await fixture()
    delete f.params.taskOrigin
    expect(await performAttach(f.input)).toMatchObject({ ok: false })
    expect(f.adapter.acquire).not.toHaveBeenCalled()
    expect(f.store.getRecord(f.request.sessionId)).toBeNull()
  })

  it('keeps personal acquisition on its existing path without extra Task transactions', async () => {
    const f = await fixture()
    delete f.params.taskOrigin
    f.params.envelope.clientOperationId = `${TASK_TEST_NOW}-${'c'.repeat(32)}`
    f.input.authority.handoffOperationId = f.params.envelope.clientOperationId
    const sourceCheck = vi.spyOn(f.store, 'assertTaskAcquisition')
    expect(await performAttach(f.input)).toMatchObject({ ok: true })
    expect(f.adapter.acquire).toHaveBeenCalledOnce()
    expect(sourceCheck).not.toHaveBeenCalled()
    expect(f.store.tasks.get(f.command)?.structuredBinding).toBeUndefined()
    expect(f.store.getRecord(f.request.sessionId)?.taskSource).toBeUndefined()
  })
})
