import { createHash } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import {
  WorkflowHandoffSchema,
  WorkflowReviewSchema
} from '../../../src/shared/task-workflow/workflow-evidence.ts'
import { validateWorkflowNativeOutcome } from './workflow-native-outcome-policy.mjs'
import { hasWorkflowNativeTestEvidence } from './workflow-native-test-evidence.mjs'
import { requireWorkflowCase, readWorkflowCaseRun } from './workflow-case-run-records.mjs'
import {
  workflowRoleExecutionForAsset,
  WorkflowCaseOutcomeConsumedPayloadSchema
} from './workflow-case-evidence-projection.mjs'
import { admitWorkflowCaseStageInTransaction } from './workflow-case-stage-admission.mjs'
import { requireLinearWorkflowDefinition, workflowStageKey } from './workflow-pipeline-policy.mjs'
import { refuseTaskRepository as refuse } from './task-delivery-repository.mjs'

const ref = (kind, value) =>
  `${kind}:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
export function workflowHandoffSummary(text) {
  const trimmed = text.trim()
  let end = 0,
    characters = 0
  for (const character of trimmed) {
    if (characters === 2048) {
      break
    }
    end += character.length
    characters++
  }
  return trimmed.slice(0, end) || 'Native role output'
}

async function event(db, task, payload) {
  await db`INSERT INTO pipeline_case_events(company_id,case_id,type,actor_type,actor_agent_id,run_id,payload)
    VALUES(${task.company_id},${task.run_scope.caseId},'updated','agent',${task.agent_id},${task.run_id},${db.json(payload)})`
}

function handoff(view, asset, report, target) {
  const context = asset.outcome.context
  const dependencies = context.handoffRefs.map((handoffRef) => {
    const source = view.handoffs.find((item) => item.handoffRef === handoffRef)
    if (!source) {
      refuse('REVISION_CONFLICT')
    }
    return { stageRef: source.stageRef, handoffRef, artifact: source.artifact }
  })
  return WorkflowHandoffSchema.parse({
    contractVersion: 1,
    kind: 'workflow.handoff',
    handoffRef: ref('handoff', [asset.version, target.stageRef]),
    binding: view.binding,
    stageRef: context.stageRef,
    producer: workflowRoleExecutionForAsset(asset),
    consumer: { stageRef: target.stageRef, employeeRef: target.employeeRef, role: target.role },
    artifact: report.version,
    ...(asset.outcome.codeVersion ? { codeVersion: asset.outcome.codeVersion } : {}),
    dependencyVersions: dependencies,
    summary: workflowHandoffSummary(report.text),
    audienceScope: {
      scope: view.binding.scope,
      employeeRefs: [context.employeeRef, target.employeeRef]
    }
  })
}

/** Runs only inside the original terminal settlement transaction, after its native rows were updated. */
export async function consumeWorkflowCaseOutcome(db, accountId, task, receipt, nativeDelivery) {
  if (
    task.run_scope.kind !== 'workbenchCase' ||
    receipt.status === 'cancelled' ||
    task.cancel_requested
  ) {
    return
  }
  const scope = task.run_scope
  const { view } = await requireWorkflowCase(db, accountId, {
    projectId: scope.projectId,
    caseId: scope.caseId
  })
  const stages = requireLinearWorkflowDefinition(view.workflow.definition)
  const current = view.stageTasks.find((item) => item.stageRef === scope.stageRef)
  const record = await readWorkflowCaseRun(db, accountId, task.id, task.run_id)
  if (
    view.currentStageRef !== scope.stageRef ||
    view.terminalKind !== null ||
    current?.taskId !== task.id ||
    current.employeeRef !== task.agent_id ||
    current.role !== scope.role ||
    record.run.startRequest.expectedCaseRevision !== view.revision
  ) {
    refuse('REVISION_CONFLICT')
  }
  const [business] =
    await db`SELECT parent_case_id,child_count,terminal_child_count FROM pipeline_cases
    WHERE id=${view.id} AND company_id=${task.company_id} AND version=${view.revision}
      AND terminal_kind IS NULL AND retired_at IS NULL FOR UPDATE`
  const children =
    await db`SELECT id FROM pipeline_cases WHERE parent_case_id=${view.id} LIMIT 1 FOR SHARE`
  if (
    !business ||
    business.parent_case_id !== null ||
    business.child_count !== 0 ||
    business.terminal_child_count !== 0 ||
    children.length
  ) {
    refuse('CAPABILITY_UNAVAILABLE')
  }
  if (
    !nativeDelivery &&
    receipt.status === 'failed' &&
    receipt.stopProof.evidenceKind === 'not_started'
  ) {
    await event(db, task, {
      kind: 'hive.workflow.stage_unavailable',
      reason: 'native_not_started',
      stageRef: scope.stageRef
    })
    return
  }
  const { delivery, report, proposal } = validateWorkflowNativeOutcome(
    task,
    receipt,
    nativeDelivery
  )
  const { asset } = delivery
  const actor = { type: 'agent', agentId: task.agent_id, runId: task.run_id }
  let acceptedHandoff, review, target
  const reportAvailable = report !== undefined && report.text.trim().length > 0
  let available = receipt.status === 'succeeded' && reportAvailable
  if (scope.role === 'tester') {
    available =
      reportAvailable &&
      proposal !== undefined &&
      (proposal.decision !== 'approved' ||
        (receipt.status === 'succeeded' && hasWorkflowNativeTestEvidence(delivery.commands)))
    if (available) {
      const subject = view.handoffs.find(
        (item) =>
          item.producer.role === 'developer' &&
          asset.outcome.context.handoffRefs.includes(item.handoffRef)
      )
      if (!subject || digest(subject.codeVersion) !== digest(proposal.testedCodeVersion)) {
        refuse('REVISION_CONFLICT')
      }
      target = view.stageTasks.find(
        (item) => item.role === (proposal.decision === 'approved' ? 'ops' : 'developer')
      )
      review = WorkflowReviewSchema.parse({
        contractVersion: 1,
        kind: 'workflow.review',
        reviewRef: ref('review', asset.version),
        binding: view.binding,
        stageRef: scope.stageRef,
        subjectHandoffRef: subject.handoffRef,
        artifact: subject.artifact,
        codeVersion: subject.codeVersion,
        reviewer: workflowRoleExecutionForAsset(asset),
        decision: proposal.decision,
        testReport: report.version
      })
    }
  } else if (scope.role !== 'ops') {
    const next = stages[stages.findIndex((item) => item.stageRef === scope.stageRef) + 1]
    target = view.stageTasks.find((item) => item.stageRef === next.stageRef)
  }
  if (available) {
    if (target) {
      acceptedHandoff = handoff(view, asset, report, target)
    }
    const [{ PgDatabase, PgDialect }, { PostgresJsSession }, kernel] = await Promise.all([
      import('@hive-paperclip-drizzle-pg'),
      import('@hive-paperclip-drizzle-session'),
      import('@hive-paperclip-case-kernel')
    ])
    const dialect = new PgDialect(),
      pg = new PgDatabase(dialect, new PostgresJsSession(db, dialect, undefined))
    const result =
      scope.role === 'tester'
        ? await kernel.reviewCaseInTransaction(pg, {
            companyId: task.company_id,
            caseId: view.id,
            expectedVersion: view.revision,
            actor,
            decision: {
              approved: 'approve',
              rejected: 'reject',
              changes_requested: 'request_changes'
            }[proposal.decision],
            reason: proposal.summary
          })
        : await kernel.transitionCaseInTransaction(pg, {
            companyId: task.company_id,
            caseId: view.id,
            expectedVersion: view.revision,
            actor,
            toStageKey: target ? workflowStageKey(target.stageRef) : 'done'
          })
    if (result.effects.automationLedgers.length) {
      refuse('CAPABILITY_UNAVAILABLE')
    }
    const expectedStage = target ? workflowStageKey(target.stageRef) : 'done'
    const [stage] = await db`SELECT id FROM pipeline_stages
      WHERE pipeline_id=${result.authoritativeCase.pipelineId} AND key=${expectedStage}`
    if (result.authoritativeCase.stageId !== stage?.id) {
      refuse('REVISION_CONFLICT')
    }
  }
  await db`UPDATE issues SET status=${available ? 'done' : 'blocked'} WHERE id=${task.id} AND company_id=${task.company_id}`
  await event(
    db,
    task,
    WorkflowCaseOutcomeConsumedPayloadSchema.parse({
      kind: 'hive.workflow.outcome_consumed',
      asset,
      ...(acceptedHandoff ? { handoff: acceptedHandoff } : {}),
      ...(review ? { review } : {})
    })
  )
  const { view: after } = await requireWorkflowCase(db, accountId, {
    projectId: scope.projectId,
    caseId: view.id
  })
  if (after.terminalKind === null) {
    try {
      await admitWorkflowCaseStageInTransaction(db, accountId, after, {
        causeRunId: task.run_id,
        stageRef: available ? target.stageRef : scope.stageRef
      })
    } catch (error) {
      if (error.code !== 'CAPABILITY_UNAVAILABLE') {
        throw error
      }
      await event(db, task, {
        kind: 'hive.workflow.admission_blocked',
        reason: error.reason ?? 'context_unavailable',
        stageRef: after.currentStageRef,
        causeRunId: task.run_id
      })
    }
  }
}
