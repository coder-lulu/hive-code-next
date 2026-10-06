import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createTaskManagedCopy } from './task-managed-copy'
import { taskCommand, TASK_TEST_LAUNCH, TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskExecutionIdentity } from './task-execution-record'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'

export async function codeSnapshotFixture(status: 'succeeded' | 'failed' = 'succeeded') {
  const evidence = resolve('logs/paperclip-development/p3/role-handoffs/code-snapshot/tmp')
  await mkdir(evidence, { recursive: true })
  const root = await mkdtemp(join(evidence, 'snapshot-'))
  const project = join(root, 'project')
  await mkdir(join(project, 'src'), { recursive: true })
  await writeFile(join(project, 'src/app.ts'), 'export const original = true\n')
  await writeFile(join(project, 'dirty.ts'), 'uncommitted source\n')
  const workspace = await createTaskManagedCopy({
    source: project,
    directory: join(root, 'workspaces'),
    assertCurrent: () => undefined
  })
  const store = await openTestAgentSessionRecordStore(root)
  const accountRef = `account:${randomUUID()}`
  const command = taskCommand({
    executionId: `execution:${randomUUID()}`,
    runtimeRecordId: `runtime:${randomUUID()}`,
    ownerScope: { kind: 'personalTenant', tenantRef: accountRef },
    executionAccountRef: accountRef,
    operationId: `${TASK_TEST_NOW}-${randomUUID().replaceAll('-', '')}`,
    task: {
      spaceId: 'company:snapshot',
      taskId: `task:${randomUUID()}`,
      runId: `run:${randomUUID()}`,
      attempt: 1,
      taskRevision: '1'
    }
  })
  const admitted = await store.tasks.admit({
    command,
    operationCallerKey: 'service:local-test',
    workspace: {
      canonicalPath: workspace.canonicalPath,
      executionPath: workspace.executionPath,
      directoryIdentity: workspace.directoryIdentity,
      hostId: 'local',
      workspaceId: TASK_TEST_LAUNCH.worktreeId,
      isolation: 'managed_copy'
    },
    now: TASK_TEST_NOW,
    validate: () => undefined
  })
  await store.tasks.beginDispatch(command, TASK_TEST_NOW, () => undefined)
  await store.tasks.bindLaunch(command, TASK_TEST_LAUNCH, TASK_TEST_NOW)
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
        proofRef: 'stop:synthetic-host-fixture',
        evidenceKind: 'stopped',
        managedToolsSettled: true,
        writersFenced: true,
        recordedAt: new Date(TASK_TEST_NOW).toISOString()
      }
    },
    TASK_TEST_NOW
  )
  return {
    root,
    project,
    record: settled.record,
    unsettled: admitted.record,
    artifacts: join(root, 'artifacts'),
    consumers: join(root, 'consumers')
  }
}
