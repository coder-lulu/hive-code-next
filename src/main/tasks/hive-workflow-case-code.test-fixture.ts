import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { workflowCaseFixture } from '../../shared/hive-workflow-cases.test-fixture'
import { HiveWorkflowCaseViewSchema } from '../../shared/hive-workflow-cases'
import { WorkflowHandoffSchema } from '../../shared/task-workflow/workflow-evidence'
import { workflowTestVectors } from '../../shared/task-workflow/workflow.test-fixture'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import { TaskCodeSnapshotStore } from './task-code-snapshot'
import { workflowOutcomeFixture } from './task-workflow-outcome.test-fixture'
import { createHiveWorkflowCaseCodeFacade } from './hive-workflow-case-code-facade'
import type { HiveWorkflowCaseCodeSource } from './hive-workflow-case-code-facade'
import type { HiveTaskRequestContext } from './hive-team-workbench-facade'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

export const codeInspectionFixtureRoot = resolve(
  'logs/paperclip-development/p3/case-code-inspection/verification/owner-facade/tmp'
)
export async function workflowCaseCodeFixture(operationCallerKey = 'trusted-local:runtime') {
  const data = workflowCaseFixture('code-inspection-owner')
  const stage = data.view.stageTasks.find((item) => item.role === 'developer')!
  const native = await workflowOutcomeFixture({
    caseView: data.view,
    task: {
      spaceId: data.team.company.id,
      taskId: stage.taskId,
      runId: randomUUID(),
      attempt: 1,
      taskRevision: '1'
    },
    operationCallerKey,
    evidenceRoot: codeInspectionFixtureRoot
  })
  const record = native.store.tasks.get(native.command)!
  const snapshots = new TaskCodeSnapshotStore(native.directory)
  const codeVersion = (await snapshots.capture(record, () => undefined)).version
  const producer = taskCodeSnapshotProducer(record)
  const tester = data.view.stageTasks.find((item) => item.role === 'tester')!
  const handoff = WorkflowHandoffSchema.parse({
    ...structuredClone(workflowTestVectors.examples.handoff),
    handoffRef: `handoff:${randomUUID()}`,
    binding: data.view.binding,
    stageRef: stage.stageRef,
    producer: {
      employeeRef: stage.employeeRef,
      role: 'developer',
      task: producer.task,
      runtimeRecordId: producer.runtimeRecordId,
      ownershipEpoch: producer.ownershipEpoch,
      executionId: producer.executionId,
      executionEpoch: producer.executionEpoch,
      commandFingerprint: producer.commandFingerprint,
      sessionRef: producer.sessionRef,
      executionWorkspaceRef: producer.executionWorkspaceId,
      workspaceExecutionClaimRef: producer.workspaceExecutionClaimRef
    },
    consumer: { stageRef: tester.stageRef, employeeRef: tester.employeeRef, role: 'tester' },
    artifact: (await native.artifacts.describe(record, record.result!.artifactRefs[0])).version,
    codeVersion,
    dependencyVersions: [],
    audienceScope: { scope: data.view.binding.scope, employeeRefs: [tester.employeeRef] }
  })
  let view = HiveWorkflowCaseViewSchema.parse({
    ...data.view,
    handoffs: [handoff]
  })
  let task = {
    id: stage.taskId,
    run_id: producer.task.runId,
    title: 'Synthetic stopped Developer',
    status: 'done',
    status_version: 1,
    company_id: data.team.company.id,
    agent_id: stage.employeeRef,
    cancel_requested: false,
    execution_stage: 'settled',
    run_scope: {
      kind: 'workbenchCase',
      projectId: data.team.project.id,
      caseId: data.view.id,
      workspaceRef: producer.workspaceRef
    },
    binding: {
      bindingRef: 'binding:owner-code-fixture',
      paperclipCompanyId: data.team.company.id,
      paperclipAgentId: stage.employeeRef,
      command: record.command,
      commandFingerprint: record.commandFingerprint
    },
    result_receipt: record.result
  }
  let current = true,
    currentRecord: TaskExecutionRecord | null = record
  const requests: string[] = []
  let onReadTask = () => undefined
  const caller: HiveTaskRequestContext = {
    accountRef: data.view.team.company.ownerAccountRef,
    assertCurrent() {
      if (!current) {
        refuseTaskExecution('FORBIDDEN')
      }
    },
    async request(path) {
      requests.push(path)
      onReadTask()
      return task
    }
  }
  let source: HiveWorkflowCaseCodeSource | null = { snapshots, readExecution: () => currentRecord }
  const facade = () =>
    createHiveWorkflowCaseCodeFacade({
      context: async () => caller,
      getWorkflowCase: async () => view,
      source
    })
  const query = {
    projectId: data.team.project.id,
    caseId: data.view.id,
    handoffRef: handoff.handoffRef
  }
  return {
    ...native,
    record,
    snapshots,
    handoff,
    query,
    requests,
    facade,
    get view() {
      return view
    },
    set view(value) {
      view = value
    },
    get task() {
      return task
    },
    set task(value) {
      task = value
    },
    get current() {
      return current
    },
    set current(value) {
      current = value
    },
    get currentRecord() {
      return currentRecord
    },
    set currentRecord(value) {
      currentRecord = value
    },
    get source() {
      return source
    },
    set source(value) {
      source = value
    },
    get onReadTask() {
      return onReadTask
    },
    set onReadTask(value) {
      onReadTask = value
    }
  }
}
