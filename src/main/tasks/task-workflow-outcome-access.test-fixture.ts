import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { vi } from 'vitest'
import {
  workflowCaseFixture,
  syntheticWorkflowStageContext
} from '../../shared/hive-workflow-cases.test-fixture'
import { WorkflowCommandEvidenceSchema } from '../../shared/task-workflow/workflow-command-evidence'
import {
  WorkflowNativeOutcomeAssetSchema,
  WorkflowNativeOutcomeSchema
} from '../../shared/task-workflow/workflow-native-outcome'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { TaskExecutionHost, type TaskExecutionHostDependencies } from './task-execution-host'
import { TaskExecutionError } from './task-execution-error'
import { createLocalTaskAuthorizer, type LocalTaskGrant } from './local-task-authority'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import { taskExecutionIdentity } from './task-execution-record'
import {
  taskCapabilities,
  taskCommand,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

export function outcomeByteVersion(value: unknown) {
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex')
  return { artifactRef: `artifact:${digest}`, artifactRevision: 1 as const, digest }
}

export async function outcomeAccessFixture(commandCount = 0) {
  const parent = resolve('logs/paperclip-development/p3/case-outcomes/outcome-transport/tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'access-'))
  const f = workflowCaseFixture(),
    stage = f.view.stageTasks.find((item) => item.role === 'product')!
  const command = taskCommand({
    ownerScope: f.view.team.company.ownerScope,
    executionAccountRef: f.view.team.company.ownerAccountRef,
    task: {
      spaceId: f.view.binding.scope.companyRef,
      taskId: stage.taskId,
      runId: 'run:outcome-access',
      attempt: 1,
      taskRevision: '1'
    },
    workflowContext: syntheticWorkflowStageContext(f.view, stage.stageRef),
    executionDeadlineAt: new Date(TASK_TEST_NOW + 60_000).toISOString(),
    executionPolicy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: `docker-enforcement:${'a'.repeat(64)}`
    }
  })
  const store = await openTestAgentSessionRecordStore(root)
  const workspace = taskWorkspace(root)
  const admitted = await store.tasks.admit({
    command,
    workspace,
    operationCallerKey: TASK_TEST_CALLER.operationCallerKey,
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
  await store.tasks.beginDispatch(command, TASK_TEST_NOW, () => undefined)
  await store.tasks.bindLaunch(
    store.tasks.get(command)!,
    {
      worktreeId: workspace.workspaceId,
      outcome: {
        kind: 'structured',
        sessionId: 'session:outcome-access',
        handle: 'worker:outcome-access'
      },
      receipt: {
        mode: 'structured',
        preferred: 'structured',
        reason: 'user_default',
        detail: 'Fixture.'
      }
    },
    TASK_TEST_NOW
  )
  const beforeStop = store.tasks.get(command)!
  const settled = await store.tasks.settle(
    command,
    {
      ...taskExecutionIdentity(command),
      commandFingerprint: admitted.record.commandFingerprint,
      kind: 'execution.result',
      receiptId: 'result:outcome-access',
      recordedAt: new Date(TASK_TEST_NOW).toISOString(),
      outcomeRef: 'outcome:access',
      status: 'succeeded',
      artifactRefs: [],
      usageFactRefs: [],
      stopProof: {
        proofRef: 'stop:synthetic-access-fixture',
        evidenceKind: 'stopped',
        managedToolsSettled: true,
        writersFenced: true,
        recordedAt: new Date(TASK_TEST_NOW).toISOString()
      }
    },
    TASK_TEST_NOW
  )
  const record = settled.record,
    producer = taskCodeSnapshotProducer(record)
  const commands = WorkflowCommandEvidenceSchema.parse({
    kind: 'available',
    producer,
    sessionId: producer.sessionRef,
    journalCursor: { epoch: 'journal:outcome', sequence: commandCount + 2 },
    turnItemId: agentJournalItemKey({ provider: 'orca', clientMessageId: 'turn:outcome' }),
    turnRevision: 1,
    turnSequence: 1,
    providerTurnId: 'turn:outcome',
    turnOutcome: 'success',
    commands: Array.from({ length: commandCount }, (_, i) => ({
      itemId: agentJournalItemKey({ provider: 'orca', clientMessageId: `command:${i}` }),
      revision: 1,
      callId: `call:${i}`,
      sequence: i + 2,
      command: 'pnpm test',
      cwd: '/execution',
      state: 'completed',
      exitCode: 0,
      output: {
        head: 'x'.repeat(16 * 1024),
        byteLength: 16 * 1024,
        digest: createHash('sha256')
          .update('x'.repeat(16 * 1024))
          .digest('hex'),
        truncated: false
      }
    }))
  })
  const commandsVersion = outcomeByteVersion(commands)
  const outcome = WorkflowNativeOutcomeSchema.parse({
    contractVersion: 1,
    kind: 'workflow.native-outcome',
    context: command.workflowContext,
    producer,
    artifacts: [],
    commands: { kind: 'available', artifact: commandsVersion }
  })
  const asset = WorkflowNativeOutcomeAssetSchema.parse({
    outcome,
    version: outcomeByteVersion(outcome)
  })
  let now = TASK_TEST_NOW,
    ownershipEpoch = command.ownershipEpoch,
    granted = true,
    callerCurrent = true
  const account = {
    accountId: 'account:outcome',
    authorityId: 'authority:outcome',
    sessionGeneration: 1,
    sessionExpiresAt: TASK_TEST_NOW + 120_000,
    accessToken: 'fixture-only'
  }
  const grant: LocalTaskGrant = {
    command,
    workspace,
    input: 'Private task input.',
    ...TASK_TEST_CALLER,
    accountId: account.accountId,
    authorityId: account.authorityId,
    sessionGeneration: 1,
    runtimeOwnershipEpoch: ownershipEpoch,
    validUntil: TASK_TEST_NOW + 120_000,
    actions: ['observe'],
    assertCurrent: () => undefined
  }
  const caller = {
    ...TASK_TEST_CALLER,
    assertCurrent: () => {
      if (!callerCurrent) {
        throw new TaskExecutionError('FORBIDDEN')
      }
    }
  }
  const deps: TaskExecutionHostDependencies & { authorizeEnforcement: () => Promise<void> } = {
    authorizeEnforcement: vi.fn(async () => undefined),
    store: store.tasks,
    capabilities: () => taskCapabilities(command),
    now: () => now,
    authorize: vi.fn(
      createLocalTaskAuthorizer({
        currentAccount: () => account,
        currentRuntime: () => ({
          runtimeRecordId: command.runtimeRecordId,
          ownershipEpoch,
          accountId: account.accountId
        }),
        resolveGrant: (ref) => (ref === command.authorizationRef && granted ? grant : null),
        now: () => now
      })
    ),
    launch: vi.fn(),
    stop: vi.fn(),
    collect: vi.fn(),
    workflowOutcomes: {
      read: vi.fn(async (_record, guard) => {
        guard()
        await Promise.resolve()
        guard()
        return asset
      }),
      readCommands: vi.fn(async (_record, _artifactRef, guard) => {
        guard()
        await Promise.resolve()
        guard()
        return commands
      }),
      readArtifact: vi.fn(async (_record, _artifactRef, guard) => {
        guard()
        throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
      })
    }
  }
  const query = {
    ...taskExecutionIdentity(command),
    commandFingerprint: record.commandFingerprint,
    authorizationRef: command.authorizationRef,
    authorizationRevision: command.authorizationRevision,
    expiresAt: command.expiresAt,
    kind: 'workflow.outcome.read' as const
  }
  const commandQuery = {
    ...query,
    kind: 'workflow.commands.read' as const,
    artifactRef: commandsVersion.artifactRef
  }
  return {
    root,
    deps,
    store,
    record,
    beforeStop,
    command,
    query,
    commandQuery,
    asset,
    commands,
    caller,
    host: new TaskExecutionHost(deps),
    revokeOwner: () => {
      ownershipEpoch += 1
    },
    revokeGrant: () => {
      granted = false
    },
    revokeCaller: () => {
      callerCurrent = false
    },
    expire: () => {
      now += 60_001
    }
  }
}
