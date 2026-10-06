import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  workflowCaseFixture,
  syntheticWorkflowStageContext
} from '../../shared/hive-workflow-cases.test-fixture'
import type { WorkflowExecutionContext } from '../../shared/task-workflow/workflow-execution-context'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { createTaskManagedCopy } from './task-managed-copy'
import { taskCommand, TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { taskDockerBinding } from './task-docker-identity'
import { TaskArtifactIndex, taskResultManifestName } from './task-artifact-index'

export async function workflowOutcomeFixture(
  options: {
    status?: 'succeeded' | 'failed'
    context?: WorkflowExecutionContext
  } = {}
) {
  const parent = resolve('logs/paperclip-development/p3/case-outcomes/outcome-assets/tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'outcome-')),
    project = join(root, 'project')
  await mkdir(project)
  await writeFile(join(project, 'app.js'), 'export const value = 1\n')
  const view = workflowCaseFixture('outcome-owner').view,
    stage = view.stageTasks.find((item) => item.role === 'developer')!,
    context = options.context ?? syntheticWorkflowStageContext(view, stage.stageRef)
  const copy = await createTaskManagedCopy({
    source: project,
    directory: join(root, 'workspaces'),
    assertCurrent: () => undefined
  })
  const store = await openTestAgentSessionRecordStore(join(root, 'records')),
    command = taskCommand({
      ownerScope: view.team.company.ownerScope,
      executionAccountRef: view.team.company.ownerAccountRef,
      executionId: `execution:${randomUUID()}`,
      task: {
        spaceId: context.binding.scope.companyRef,
        taskId: `task:${randomUUID()}`,
        runId: `run:${randomUUID()}`,
        attempt: 1,
        taskRevision: '1'
      },
      workflowContext: context,
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
  const admitted = await store.tasks.admit({
    command,
    workspace,
    operationCallerKey: 'service:local-test',
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
  await store.tasks.beginDispatch(command, TASK_TEST_NOW, () => undefined)
  // Unit metadata exercises the original store; it does not qualify actual Docker or Provider execution.
  const identity = {
    ...taskDockerBinding(admitted.record),
    dockerPath: join(root, 'docker'),
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
  await store.tasks.persistDockerIdentity(command, identity, TASK_TEST_NOW, () => undefined)
  await store.tasks.persistDockerIdentity(
    command,
    { ...identity, containerId: 'c'.repeat(64) },
    TASK_TEST_NOW,
    () => undefined
  )
  await store.tasks.bindLaunch(
    command,
    {
      worktreeId: workspace.workspaceId,
      outcome: { kind: 'structured', sessionId: 'session:outcome', handle: 'worker:outcome' },
      receipt: {
        mode: 'structured',
        preferred: 'structured',
        reason: 'user_default',
        detail: 'unit fixture'
      }
    },
    TASK_TEST_NOW
  )
  const running = store.tasks.get(command)!,
    artifacts = new TaskArtifactIndex(join(root, 'artifacts')),
    status = options.status ?? 'succeeded'
  await writeFile(join(copy.executionPath, 'report.md'), 'Original result report\n')
  await writeFile(
    join(copy.executionPath, taskResultManifestName(running.commandFingerprint)),
    JSON.stringify({
      schemaVersion: 1,
      executionId: command.executionId,
      commandFingerprint: running.commandFingerprint,
      status,
      artifacts: ['report.md']
    })
  )
  const candidate = (await artifacts.collect(
    running,
    status === 'succeeded' ? 'success' : 'failure'
  ))!
  const { record } = await store.tasks.settle(
    command,
    {
      ...taskExecutionIdentity(command),
      ...candidate,
      status,
      kind: 'execution.result',
      commandFingerprint: running.commandFingerprint,
      receiptId: `receipt:${randomUUID()}`,
      recordedAt: new Date(TASK_TEST_NOW).toISOString(),
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
  return { root, store, command, record, running, artifacts, directory: join(root, 'artifacts') }
}
