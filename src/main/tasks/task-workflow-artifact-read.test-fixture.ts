import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { vi } from 'vitest'
import { workflowCaseFixture } from '../../shared/hive-workflow-cases.test-fixture'
import { hiveWorkflowStageContext } from '../../shared/hive-workflow-stage-context'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import { WorkflowCommandEvidenceSchema } from '../../shared/task-workflow/workflow-command-evidence'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { createTaskManagedCopy } from './task-managed-copy'
import { TaskArtifactIndex, taskResultManifestName } from './task-artifact-index'
import { TaskCodeSnapshotStore } from './task-code-snapshot'
import { TaskWorkflowOutcomeStore } from './task-workflow-outcome-store'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import { taskDockerBinding } from './task-docker-identity'
import { taskExecutionIdentity, type TaskExecutionRecord } from './task-execution-record'
import { TaskExecutionHost } from './task-execution-host'
import { TaskExecutionError } from './task-execution-error'
import { createLocalTaskAuthorizer, type LocalTaskGrant } from './local-task-authority'
import { createLocalTaskServiceCredential } from './local-task-service-credential'
import { startLocalTaskTransport } from './local-task-transport'
import { LocalTaskClient } from './local-task-client'
import { taskCommand, taskCapabilities, TASK_TEST_NOW } from './task-execution.test-fixture'

export const artifactTextSha = (text: string | Buffer) =>
  createHash('sha256').update(text).digest('hex')
export const artifactTextRef = (fingerprint: string, name: string, digest: string) =>
  `artifact:${artifactTextSha(JSON.stringify([fingerprint, name, digest]))}`

/** Actual record/files/HTTP with synthetic authorization, Docker metadata and empty command facts. */
export async function artifactReadFixture(
  content: Buffer = Buffer.from('{"decision":"approved","summary":"Unit fixture only"}\n')
) {
  const parent = resolve(
    'logs/paperclip-development/p3/case-orchestration/native-artifact-read/tmp'
  )
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'artifact-')),
    project = join(root, 'project')
  await mkdir(project)
  await writeFile(join(project, 'app.js'), 'export const value = 1\n')
  const view = workflowCaseFixture('unit-artifact-owner').view,
    stage = view.stageTasks.find((item) => item.role === 'developer')!
  const copy = await createTaskManagedCopy({
    source: project,
    directory: join(root, 'workspaces'),
    assertCurrent: () => undefined
  })
  const store = await openTestAgentSessionRecordStore(join(root, 'records'))
  const command = taskCommand({
    ownerScope: view.team.company.ownerScope,
    executionAccountRef: view.team.company.ownerAccountRef,
    executionId: `execution:${randomUUID()}`,
    task: {
      spaceId: view.binding.scope.companyRef,
      taskId: stage.taskId,
      runId: `run:${randomUUID()}`,
      attempt: 1,
      taskRevision: '1'
    },
    workflowContext: hiveWorkflowStageContext(view, stage.stageRef),
    executionDeadlineAt: new Date(TASK_TEST_NOW + 60_000).toISOString(),
    executionPolicy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: `docker-enforcement:${'a'.repeat(64)}`
    }
  })
  const workspace = {
    canonicalPath: copy.canonicalPath,
    executionPath: copy.executionPath,
    directoryIdentity: copy.directoryIdentity,
    workspaceId: `folder:${randomUUID()}`,
    hostId: 'local' as const,
    isolation: 'managed_copy' as const
  }
  const operationCallerKey = 'service:unit-artifact'
  const admitted = await store.tasks.admit({
    command,
    workspace,
    operationCallerKey,
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
  await store.tasks.beginDispatch(command, TASK_TEST_NOW, () => undefined)
  const dockerIdentity = {
    ...taskDockerBinding(admitted.record),
    dockerPath: join(root, 'unit-docker'),
    endpoint: 'unit:docker',
    imageId: `sha256:${'b'.repeat(64)}`,
    containerId: null,
    daemon: {
      ID: 'unit-daemon',
      OSType: 'linux' as const,
      Architecture: 'amd64' as const,
      ServerVersion: 'unit'
    }
  }
  await store.tasks.persistDockerIdentity(command, dockerIdentity, TASK_TEST_NOW, () => undefined)
  await store.tasks.persistDockerIdentity(
    command,
    { ...dockerIdentity, containerId: 'c'.repeat(64) },
    TASK_TEST_NOW,
    () => undefined
  )
  await store.tasks.bindLaunch(
    command,
    {
      worktreeId: workspace.workspaceId,
      outcome: {
        kind: 'structured',
        sessionId: 'session:unit-artifact',
        handle: 'worker:unit-artifact'
      },
      receipt: {
        mode: 'structured',
        preferred: 'structured',
        reason: 'user_default',
        detail: 'Unit fixture only.'
      }
    },
    TASK_TEST_NOW
  )
  const beforeStop = store.tasks.get(command)!,
    directory = join(root, 'artifacts'),
    artifacts = new TaskArtifactIndex(directory)
  await writeFile(join(copy.executionPath, 'report.json'), content)
  await writeFile(
    join(copy.executionPath, taskResultManifestName(beforeStop.commandFingerprint)),
    JSON.stringify({
      schemaVersion: 1,
      executionId: command.executionId,
      commandFingerprint: beforeStop.commandFingerprint,
      status: 'succeeded',
      artifacts: ['report.json']
    })
  )
  const candidate = (await artifacts.collect(beforeStop, 'success'))!
  const { record } = await store.tasks.settle(
    command,
    {
      ...taskExecutionIdentity(command),
      ...candidate,
      status: 'succeeded',
      kind: 'execution.result',
      commandFingerprint: beforeStop.commandFingerprint,
      receiptId: `receipt:${randomUUID()}`,
      recordedAt: new Date(TASK_TEST_NOW).toISOString(),
      usageFactRefs: [],
      stopProof: {
        proofRef: 'stop:synthetic-unit-artifact',
        evidenceKind: 'stopped',
        managedToolsSettled: true,
        writersFenced: true,
        recordedAt: new Date(TASK_TEST_NOW).toISOString()
      }
    },
    TASK_TEST_NOW
  )
  const snapshots = new TaskCodeSnapshotStore(directory),
    capture = vi.spyOn(snapshots, 'capture')
  const collectCommands = vi.fn(async (current: TaskExecutionRecord) => {
    const producer = taskCodeSnapshotProducer(current)
    return WorkflowCommandEvidenceSchema.parse({
      kind: 'available',
      producer,
      sessionId: producer.sessionRef,
      journalCursor: { epoch: 'journal:unit-artifact', sequence: 1 },
      turnItemId: agentJournalItemKey({ provider: 'orca', clientMessageId: 'turn:unit-artifact' }),
      turnRevision: 1,
      turnSequence: 1,
      providerTurnId: 'turn:unit-artifact',
      turnOutcome: 'success',
      commands: []
    })
  })
  const outcomes = new TaskWorkflowOutcomeStore({
    directory,
    artifacts,
    snapshots,
    collectCommands
  })
  let now = TASK_TEST_NOW,
    ownershipEpoch = command.ownershipEpoch,
    callerCurrent = true,
    granted = true
  const account = {
    accountId: 'unit-artifact-account',
    authorityId: 'unit-artifact-authority',
    sessionGeneration: 1,
    sessionExpiresAt: TASK_TEST_NOW + 120_000,
    accessToken: 'unit-artifact-only'
  }
  const grant: LocalTaskGrant = {
    command,
    workspace,
    input: 'Private unit artifact input.',
    operationCallerKey,
    accountId: account.accountId,
    authorityId: account.authorityId,
    sessionGeneration: 1,
    runtimeOwnershipEpoch: ownershipEpoch,
    validUntil: TASK_TEST_NOW + 120_000,
    actions: ['observe'],
    assertCurrent: () => undefined
  }
  const caller = {
    operationCallerKey,
    assertCurrent: () => {
      if (!callerCurrent) {
        throw new TaskExecutionError('FORBIDDEN')
      }
    }
  }
  const unavailable = vi.fn(async () => {
    throw new Error('Artifact read must not launch, stop or collect execution')
  })
  const authorize = vi.fn(
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
  )
  const host = new TaskExecutionHost({
    store: store.tasks,
    workflowOutcomes: outcomes,
    capabilities: () => taskCapabilities(command),
    now: () => now,
    authorizeEnforcement: vi.fn(async () => undefined),
    authorize,
    launch: unavailable,
    stop: unavailable,
    collect: unavailable
  })
  const credential = createLocalTaskServiceCredential(operationCallerKey)
  const transport = await startLocalTaskTransport({
    host,
    capabilities: () => taskCapabilities(command),
    authenticate: (bearer) => (credential.authenticate(bearer) ? caller : null)
  })
  const client = new LocalTaskClient({ baseUrl: transport.baseUrl, secret: credential.secret })
  const query = {
    ...taskExecutionIdentity(command),
    commandFingerprint: record.commandFingerprint,
    authorizationRef: command.authorizationRef,
    authorizationRevision: command.authorizationRevision,
    expiresAt: command.expiresAt,
    kind: 'workflow.artifact.read' as const,
    artifactRef: record.result!.artifactRefs[0]
  }
  return {
    root,
    project,
    directory,
    record,
    beforeStop,
    store,
    artifacts,
    snapshots,
    capture,
    outcomes,
    collectCommands,
    command,
    content,
    caller,
    authorize,
    host,
    client,
    query,
    unavailable,
    transport,
    credential,
    revokeOwner: () => {
      ownershipEpoch += 1
    },
    revokeCaller: () => {
      callerCurrent = false
    },
    revokeGrant: () => {
      granted = false
    },
    expire: () => {
      now += 60_001
    },
    close: () => transport.close()
  }
}
