import { NO_STRUCTURED_AGENTS } from '../native-chat/agent-session-wire/structured-agent-session-adapter-router-test-support'
import { join, resolve } from 'node:path'
import { afterEach, vi } from 'vitest'
import { taskDockerFixture } from './task-docker-boundary.test-fixture'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'
import { taskCodexLaunchOptions } from './task-codex-launch-options'
import type { TaskCodexAccountScope } from './task-codex-account-scope'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { createStructuredTaskCodexRuntime } from '../runtime/structured-task-codex-runtime'
import { fakeCodex } from '../codex/codex-structured-session-adapter-fixture'
import { CodexStructuredSessionAdapter } from '../codex/codex-structured-session-adapter'
import { createCodexStructuredLaunchResolver } from '../codex/codex-structured-launch-resolution'
import type { getCodexBackendAuthHeaders } from '../rate-limits/codex-backend-auth'
import type { openCodexAppServerConnection } from '../codex/codex-app-server-connection'
import { computeAgentSessionPayloadFingerprint } from '../../shared/agent-session-mutation-envelope'
import {
  attachFingerprintFields,
  reserveRequestFor,
  journalIdentityFor,
  type AgentSessionAttachParams
} from '../native-chat/agent-session-wire/structured-agent-session-attach'
import type { AttachFlowInput } from '../native-chat/agent-session-wire/structured-agent-session-attach-flow'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'
import { recordingStructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger-test-support'
import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'

afterEach(closeTestJournalHostDatabases)

/** Offline transport/account fixtures only; no provider or real Docker qualification. */
export async function taskCodexRuntimeFixture(
  taskReference?: TaskExecutionStart['task'],
  commandPatch?: Partial<TaskExecutionStart>
) {
  const docker = await taskDockerFixture()
  const directory = join(docker.root, 'host-state')
  const original = taskStructuredFixture(
    docker.options.record.workspace,
    taskReference,
    commandPatch
  )
  original.request.accountHome.path = resolve(docker.root, 'synthetic-managed-home')
  const store = await openTestAgentSessionRecordStore(directory)
  await store.tasks.admit(original.admission)
  await store.tasks.beginDispatch(original.command, TASK_TEST_NOW, original.validate)
  await store.admitOperation({ ...original.outer, now: TASK_TEST_NOW })
  await store.claimOperation(original.outer)
  const params: AgentSessionAttachParams = {
    envelope: {
      sessionId: original.request.sessionId,
      clientOperationId: original.request.operation.operationId,
      expectedRuntimeFence: null,
      payloadFingerprint: ''
    },
    location: original.request.location,
    provider: 'codex',
    agent: 'codex',
    accountHome: original.request.accountHome,
    runtimeKind: 'native',
    options: taskCodexLaunchOptions(),
    taskOrigin: original.origin
  }
  params.envelope.payloadFingerprint = computeAgentSessionPayloadFingerprint({
    method: 'agentSession.attach',
    sessionId: params.envelope.sessionId,
    fields: attachFingerprintFields(params)
  })
  let revoked = false
  const assertAccount = vi.fn(() => {
    if (revoked) {
      throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
    }
  })
  const account: TaskCodexAccountScope = Object.freeze({
    accountId: 'synthetic-managed-row',
    codexHome: params.accountHome.path,
    providerAccountId: 'synthetic-provider',
    assertCurrent: assertAccount,
    assertMetadataCurrent: assertAccount
  })
  const resolvePinned = vi.fn((home: string) => {
    expectPinned(home, account.codexHome)
    assertAccount()
    return account
  })
  const listeners = new Set<() => void>()
  const unsubscribe = vi.fn<() => void>()
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      unsubscribe()
    }
  })
  const codex = fakeCodex({
    'thread/start': () => ({
      thread: { id: 'task-fixture-thread' },
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low'
    })
  })
  const readAuth = vi.fn<typeof getCodexBackendAuthHeaders>(async () => null)
  const request = vi.fn<typeof fetch>(async () => {
    throw new Error('no-offline-provider-call')
  })
  const openDocker = vi.fn<typeof openCodexAppServerConnection>(async (launch, handlers) => {
    const identity = store.tasks.get(original.command)?.dockerIdentity
    if (!identity?.containerId) {
      throw new Error('CID was not committed before attach')
    }
    docker.start()
    const raw = await codex.openConnection(launch, handlers)
    if (typeof raw.pid !== 'number') {
      throw new Error('synthetic attach PID missing')
    }
    await handlers?.onSpawned?.(raw.pid)
    return raw
  })
  const resolveWorkspacePath = vi.fn(async (id: string) => {
    if (id !== original.request.location.workspaceId) {
      throw new Error('foreign-workspace')
    }
    return docker.options.record.workspace.executionPath
  })
  const resolveDockerConfiguration = vi.fn(() => ({
    dockerPath: docker.options.dockerPath,
    endpoint: docker.options.endpoint,
    imageId: docker.options.imageId
  }))
  const taskRuntime = createStructuredTaskCodexRuntime(
    {
      logger: recordingStructuredAgentSessionLogger().logger,
      stateDirectory: directory,
      hostId: 'local',
      claimKeyId: 'synthetic-claim',
      resolveLaunchArgs: () => [],
      resolveWorkspacePath,
      resolveClaudeAuthPolicy: () => {
        throw new Error('unused-personal-Claude-policy')
      },
      taskCodexAccounts: { resolvePinned, resolveSelected: () => account, subscribe },
      taskDocker: {
        resolveDockerConfiguration,
        runDocker: docker.run,
        openDocker,
        readAuth,
        request
      }
    },
    store
  )
  const nativeEnvironment = vi.fn(async () => ({ CODEX_HOME: '/personal/native-home' }))
  const nativeCommand = vi.fn(() => 'personal-codex')
  const nativeOpen = vi.fn<typeof openCodexAppServerConnection>(codex.openConnection)
  const adapter = new CodexStructuredSessionAdapter({
    resolveLaunch: createCodexStructuredLaunchResolver({
      store,
      resolveWorkspacePath,
      resolveEnvironment: nativeEnvironment,
      resolveCommand: nativeCommand,
      resolveLaunchArgs: () => [],
      resolveTaskLaunch: taskRuntime.resolveLaunch
    }),
    openConnection: nativeOpen,
    readProcessStartTime: async () => TASK_TEST_NOW - 1000,
    now: () => TASK_TEST_NOW
  })
  const flow: AttachFlowInput = {
    agents: NO_STRUCTURED_AGENTS,
    logger: recordingStructuredAgentSessionLogger().logger,
    store,
    adapter,
    params,
    callerKey: original.origin.operationCallerKey,
    authority: {
      spawnToken: original.request.spawnToken,
      claimKeyId: original.request.claimKeyId,
      handoffOperationId: params.envelope.clientOperationId,
      probe: original.request.probe
    },
    now: () => TASK_TEST_NOW,
    onAttached: () => undefined,
    openConversation: async () => {
      throw new Error('acquisition-only-fixture')
    }
  }
  const reservation = await store.reserveOwner(
    reserveRequestFor({
      sessionId: params.envelope.sessionId,
      params,
      authority: flow.authority,
      callerKey: flow.callerKey,
      fingerprint: params.envelope.payloadFingerprint,
      now: TASK_TEST_NOW
    })
  )
  const record = reservation.record
  const token = record.lease.reservedSpawnToken
  if (!token) {
    throw new Error('original Task reservation token missing')
  }
  const acquireInput: StructuredAgentSessionAcquireInput = {
    identity: journalIdentityFor(record, params),
    fence: record.lease.runtimeFence,
    spawnToken: token,
    taskOrigin: original.origin,
    options: params.options,
    spawnGuard: {
      prepare: async () => {
        await store.assertTaskAcquisition(
          reserveRequestFor({
            sessionId: record.sessionId,
            params,
            authority: flow.authority,
            callerKey: flow.callerKey,
            fingerprint: params.envelope.payloadFingerprint,
            now: TASK_TEST_NOW
          }),
          record
        )
      },
      assertCurrent: original.validate
    }
  }
  return {
    ...original,
    docker,
    directory,
    store,
    record,
    acquireInput,
    flow,
    adapter,
    taskRuntime,
    account,
    assertAccount,
    subscribe,
    unsubscribe,
    resolvePinned,
    resolveDockerConfiguration,
    nativeEnvironment,
    nativeCommand,
    nativeOpen,
    readAuth,
    request,
    openDocker,
    codex,
    revoke: () => {
      revoked = true
    },
    accountsChanged: () => {
      for (const listener of listeners) {
        listener()
      }
    }
  }
}

function expectPinned(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
  }
}
