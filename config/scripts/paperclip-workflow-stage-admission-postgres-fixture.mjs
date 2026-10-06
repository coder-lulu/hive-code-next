import { createHash, randomUUID } from 'node:crypto'
import { createWorkflowCasePostgresFixture } from './paperclip-workflow-cases-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { createWorkflowCaseRepository } from '../../integration/paperclip/service/workflow-case-repository.mjs'
import {
  createWorkflowCaseRunRepository,
  admitWorkflowCaseStageInTransaction
} from '../../integration/paperclip/service/workflow-case-run-repository.mjs'
import { workflowRoleExecutionForAsset } from '../../integration/paperclip/service/workflow-case-evidence-projection.mjs'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import {
  WorkflowNativeOutcomeSchema,
  WorkflowNativeOutcomeAssetSchema
} from '../../src/shared/task-workflow/workflow-native-outcome.ts'

const names = {
  product: 'requirements.md',
  developer: 'implementation.md',
  tester: 'test-report.md',
  ops: 'release-plan.md'
}
const version = (text) => {
  const hash = createHash('sha256').update(text).digest('hex')
  return { artifactRef: `artifact:${hash}`, artifactRevision: 1, digest: hash }
}

/** Synthetic, closed native database facts; this fixture does not execute a Provider or a Core kernel. */
export async function workflowStageAdmissionFixture(h, duration = 600_000) {
  const workbench = createTeamWorkbenchRepository(h.sql)
  const workflows = createWorkflowDefinitionRepository(h.sql)
  const cases = createWorkflowCaseRepository(h.sql)
  const runs = createWorkflowCaseRunRepository(h.sql)
  const f = await createWorkflowCasePostgresFixture({ workbench, workflows, cases })
  const workflow = await workflows.saveWorkflow(f.accountId, {
    ...f.definitionInput,
    requestId: randomUUID(),
    workflowId: f.workflow.workflowId,
    expectedRevision: 1,
    maxDurationMs: duration
  })
  const input = { ...f.input, workflowRevision: 2, definitionDigest: workflow.definitionDigest }
  const { view } = await cases.createWorkflowCase(f.accountId, input)
  const product = view.stageTasks.find((item) => item.role === 'product')
  const first = await runs.startWorkflowCase(f.accountId, {
    requestId: randomUUID(),
    projectId: f.project.id,
    caseId: view.id,
    stageRef: product.stageRef,
    expectedCaseRevision: view.revision,
    expectedTaskRevision: product.taskRevision
  })
  const read = () =>
    cases.getWorkflowCase(f.accountId, { projectId: f.project.id, caseId: view.id })
  const admit = async (causeRunId, role) => {
    const current = await read()
    const stage = current.stageTasks.find((item) => item.role === role)
    return h.sql.begin((db) =>
      admitWorkflowCaseStageInTransaction(db, f.accountId, current, {
        causeRunId,
        stageRef: stage.stageRef
      })
    )
  }
  return { ...f, workflow, input, view, first, workbench, workflows, cases, runs, read, admit }
}

export async function closeWorkflowNativeFixture(h, f, admission, options = {}) {
  const status = options.status ?? 'succeeded',
    role = admission.run.role
  const command = taskCommand({
    task: admission.run.task,
    profileId: 'codex',
    profileRevision: 'codex:1',
    runtimeRecordId: `runtime:${randomUUID()}`,
    executionId: `execution:${randomUUID()}`,
    workspaceExecutionClaimRef: `claim:${randomUUID()}`,
    ownerScope: f.view.team.company.ownerScope,
    executionAccountRef: f.view.team.company.ownerAccountRef,
    workspaceRef: f.view.team.project.hiveWorkspaceRef,
    workflowContext: admission.workflowContext,
    executionDeadlineAt: admission.executionDeadlineAt,
    inputRef: `input:${admission.inputDigest}`,
    executionPolicy: {
      trustMode: 'enforced_autonomous',
      executionPolicyRef: 'docker-local-linux',
      executionPolicyRevision: '1',
      enforcementEvidenceRef: 'synthetic:admission-pg'
    }
  })
  const binding = {
    bindingRef: `binding:${randomUUID()}`,
    paperclipCompanyId: admission.run.task.spaceId,
    paperclipAgentId: admission.run.employeeRef,
    command,
    commandFingerprint: computeTaskExecutionFingerprint(command, 'trusted-local:runtime')
  }
  await h.repository.bind(f.accountId, admission.run.task.taskId, admission.run.task.runId, binding)
  const artifact = version(`Synthetic ${role} ${admission.run.task.runId}`)
  const artifacts = options.assetOnly ? [] : [{ name: names[role], version: artifact }]
  const receipt = {
    protocolVersion: command.protocolVersion,
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch,
    executionId: command.executionId,
    executionEpoch: command.executionEpoch,
    commandFingerprint: binding.commandFingerprint,
    kind: 'execution.result',
    receiptId: `result:${randomUUID()}`,
    recordedAt: new Date().toISOString(),
    outcomeRef: `outcome:${randomUUID()}`,
    status,
    artifactRefs: artifacts.map((item) => item.version.artifactRef),
    usageFactRefs: [],
    stopProof: {
      proofRef: 'stop:synthetic-admission-pg',
      evidenceKind: 'stopped',
      managedToolsSettled: true,
      writersFenced: true,
      recordedAt: new Date().toISOString()
    }
  }
  const current = await f.read()
  const codeVersion =
    role === 'developer'
      ? {
          kind: 'snapshot',
          snapshot: version(`Original code ${command.task.runId}`),
          treeDigest: 'a'.repeat(64)
        }
      : role === 'tester'
        ? admission.workflowContext.codeInput.version
        : undefined
  const outcome = WorkflowNativeOutcomeSchema.parse({
    contractVersion: 1,
    kind: 'workflow.native-outcome',
    context: admission.workflowContext,
    producer: {
      protocolVersion: command.protocolVersion,
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      executionId: command.executionId,
      executionEpoch: command.executionEpoch,
      task: command.task,
      commandFingerprint: binding.commandFingerprint,
      operationId: command.operationId,
      operationCallerKey: 'trusted-local:runtime',
      ownerScope: command.ownerScope,
      executionAccountRef: command.executionAccountRef,
      workspaceRef: command.workspaceRef,
      executionWorkspaceId: `folder:${randomUUID()}`,
      workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
      writeFence: command.writeFence,
      sessionRef: `session:${randomUUID()}`,
      status,
      outcomeRef: receipt.outcomeRef,
      resultDigest: digest(receipt)
    },
    artifacts,
    ...(codeVersion ? { codeVersion } : {}),
    commands:
      role === 'tester' &&
      status === 'succeeded' &&
      options.decision !== 'changes_requested' &&
      options.decision !== 'rejected'
        ? {
            kind: 'available',
            artifact: version(`Synthetic original command evidence ${command.task.runId}`)
          }
        : { kind: 'unavailable', reason: 'journal_unavailable' }
  })
  const asset = WorkflowNativeOutcomeAssetSchema.parse({
    outcome,
    version: version(JSON.stringify(outcome))
  })
  const payload = { kind: 'hive.workflow.outcome_consumed', asset }
  const target =
    options.targetRole && current.stageTasks.find((item) => item.role === options.targetRole)
  if (target && !options.assetOnly) {
    payload.handoff = {
      contractVersion: 1,
      kind: 'workflow.handoff',
      handoffRef: `handoff:${command.task.runId}`,
      binding: current.binding,
      stageRef: admission.run.stageRef,
      producer: workflowRoleExecutionForAsset(asset),
      consumer: { stageRef: target.stageRef, employeeRef: target.employeeRef, role: target.role },
      artifact,
      ...(codeVersion ? { codeVersion } : {}),
      dependencyVersions: admission.workflowContext.handoffRefs.map((ref) => {
        const subject = current.handoffs.find((item) => item.handoffRef === ref)
        return { stageRef: subject.stageRef, handoffRef: ref, artifact: subject.artifact }
      }),
      summary: `Accepted ${role} attempt ${command.task.attempt}`,
      audienceScope: {
        scope: current.binding.scope,
        employeeRefs: [target.employeeRef]
      }
    }
  }
  if (role === 'tester' && !options.assetOnly) {
    const subject = current.handoffs.find(
      (item) => item.producer.task.runId === admission.workflowContext.codeInput.producer.task.runId
    )
    payload.review = {
      contractVersion: 1,
      kind: 'workflow.review',
      reviewRef: `review:${command.task.runId}`,
      binding: current.binding,
      stageRef: admission.run.stageRef,
      subjectHandoffRef: subject.handoffRef,
      artifact: subject.artifact,
      codeVersion,
      reviewer: workflowRoleExecutionForAsset(asset),
      decision: options.decision ?? 'approved',
      testReport: artifact
    }
  }
  await h.sql.begin(async (db) => {
    await db`UPDATE hive_task_bindings SET result_receipt=${db.json(receipt)} WHERE run_id=${command.task.runId}`
    await db`UPDATE heartbeat_runs SET status=${status},execution_stage='settled',result_json=${db.json(receipt)},finished_at=now()
      WHERE id=${command.task.runId}`
    await db`UPDATE issues SET status=${options.assetOnly ? 'blocked' : 'done'},status_version=status_version+1,
      checkout_run_id=NULL,execution_run_id=NULL,execution_agent_name_key=NULL,execution_locked_at=NULL WHERE id=${command.task.taskId}`
    await db`INSERT INTO pipeline_case_events(company_id,case_id,type,actor_type,actor_agent_id,run_id,payload)
      VALUES(${current.binding.scope.companyRef},${current.id},'updated','agent',${admission.run.employeeRef},${command.task.runId},${db.json(payload)})`
    if (target) {
      await db`UPDATE pipeline_cases SET stage_id=(SELECT id FROM pipeline_stages WHERE pipeline_id=pipeline_cases.pipeline_id
        AND key=${`stage_${digest(target.stageRef)}`}),version=version+1,updated_at=now() WHERE id=${current.id}`
    }
  })
  return { asset, payload, receipt, binding }
}
