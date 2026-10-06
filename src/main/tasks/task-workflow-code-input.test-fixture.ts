import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  workflowCaseFixture,
  syntheticWorkflowStageContext
} from '../../shared/hive-workflow-cases.test-fixture'
import { WorkflowExecutionContextSchema } from '../../shared/task-workflow/workflow-execution-context'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { createTaskManagedCopy } from './task-managed-copy'
import { taskCommand, TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { TaskCodeSnapshotStore } from './task-code-snapshot'

export async function workflowCodeInputFixture(status: 'succeeded' | 'failed' = 'succeeded') {
  const evidence = resolve('logs/paperclip-development/p3/role-handoffs/code-input/tmp')
  await mkdir(evidence, { recursive: true })
  const root = await mkdtemp(join(evidence, 'fixture-')),
    project = join(root, 'project')
  await mkdir(project)
  await writeFile(join(project, 'app.ts'), 'export const acceptedVersion = 1\n')
  const f = workflowCaseFixture('code-input-owner'),
    developer = f.view.stageTasks.find((stage) => stage.role === 'developer')!,
    tester = f.view.stageTasks.find((stage) => stage.role === 'tester')!
  const workspace = await createTaskManagedCopy({
    source: project,
    directory: join(root, 'producer'),
    assertCurrent: () => undefined
  })
  const store = await openTestAgentSessionRecordStore(join(root, 'records'))
  const owner = {
    accountId: 'code-input-owner',
    runtimeRecordId: 'runtime:workflow-input',
    ownershipEpoch: 2
  }
  const workspaceRef = `workspace:${createHash('sha256').update(JSON.stringify(project)).digest('hex')}`
  const command = taskCommand({
    runtimeRecordId: owner.runtimeRecordId,
    ownershipEpoch: 1,
    executionId: `execution:${randomUUID()}`,
    executionDeadlineAt: new Date(TASK_TEST_NOW + 60_000).toISOString(),
    workspaceRef,
    ownerScope: f.view.team.company.ownerScope,
    executionAccountRef: f.view.team.company.ownerAccountRef,
    task: {
      spaceId: f.view.binding.scope.companyRef,
      taskId: developer.taskId,
      runId: randomUUID(),
      attempt: 1,
      taskRevision: '1'
    },
    workflowContext: syntheticWorkflowStageContext(f.view, developer.stageRef),
    executionPolicy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: 'synthetic:unit-policy'
    }
  })
  const admitted = await store.tasks.admit({
    command,
    workspace: {
      canonicalPath: workspace.canonicalPath,
      executionPath: workspace.executionPath,
      directoryIdentity: workspace.directoryIdentity,
      hostId: 'local',
      workspaceId: 'folder:developer',
      isolation: 'managed_copy'
    },
    operationCallerKey: 'trusted-local:runtime',
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
  await store.tasks.beginDispatch(command, TASK_TEST_NOW, () => undefined)
  await store.tasks.bindLaunch(
    store.tasks.get(command)!,
    {
      worktreeId: 'folder:developer',
      outcome: { kind: 'structured', sessionId: 'session:developer', handle: 'worker:developer' },
      receipt: {
        mode: 'structured',
        preferred: 'structured',
        reason: 'user_default',
        detail: 'unit fixture'
      }
    },
    TASK_TEST_NOW
  )
  const settled = await store.tasks.settle(
    command,
    {
      ...taskExecutionIdentity(command),
      kind: 'execution.result',
      commandFingerprint: admitted.record.commandFingerprint,
      receiptId: `result:${randomUUID()}`,
      recordedAt: new Date(TASK_TEST_NOW).toISOString(),
      outcomeRef: `outcome:${randomUUID()}`,
      status,
      artifactRefs: [],
      usageFactRefs: [],
      stopProof: {
        proofRef: 'stop:synthetic-unit-fixture',
        evidenceKind: 'stopped',
        managedToolsSettled: true,
        writersFenced: true,
        recordedAt: new Date(TASK_TEST_NOW).toISOString()
      }
    },
    TASK_TEST_NOW
  )
  const record = settled.record,
    snapshots = new TaskCodeSnapshotStore(join(root, 'artifacts')),
    captured = await snapshots.capture(record)
  const producer = {
    employeeRef: developer.employeeRef,
    role: 'developer' as const,
    task: record.command.task,
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch,
    executionId: command.executionId,
    executionEpoch: command.executionEpoch,
    commandFingerprint: record.commandFingerprint,
    sessionRef: 'session:developer',
    executionWorkspaceRef: record.workspace.workspaceId,
    workspaceExecutionClaimRef: command.workspaceExecutionClaimRef
  }
  const context = WorkflowExecutionContextSchema.parse({
    kind: 'workflow.execution-context',
    binding: f.view.binding,
    definitionDigest: f.view.definitionDigest,
    stageRef: tester.stageRef,
    employeeRef: tester.employeeRef,
    role: 'tester',
    handoffRefs: ['handoff:fixed-code'],
    codeInput: { producer, version: captured.version }
  })
  const input = {
    paperclipCompanyId: command.task.spaceId,
    paperclipAgentId: tester.employeeRef,
    task: { ...command.task, taskId: tester.taskId, runId: randomUUID() },
    workspaceSelector: 'folder:project',
    input: 'Test the supplied code.',
    executionMode: 'enforced_autonomous' as const,
    executionDeadlineAt: command.executionDeadlineAt,
    workflowContext: context
  }
  return {
    ...f,
    root,
    project,
    store,
    record,
    captured,
    developer,
    tester,
    options: {
      input,
      directory: join(root, 'consumers'),
      snapshots,
      readExecution: store.tasks.get.bind(store.tasks),
      owner,
      operationCallerKey: 'trusted-local:runtime',
      originalWorkspaceRef: workspaceRef,
      assertCurrent: () => undefined
    }
  }
}
