import { randomUUID } from 'node:crypto'
import { capacityGraph } from '../../shared/hive-workflow-plan-graph-capacity.test-fixture'
import { HiveWorkflowPlanGraphViewSchema } from '../../shared/hive-workflow-plan-runs'
import { inspectWorkflowPlanProposal } from '../../shared/task-workflow/workflow-plan-validation'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { hiveWorkflowPlanGraphContext } from '../../shared/hive-workflow-plan-graph-context'

export function nativeWorkflowCapacityFixture() {
  const f = capacityGraph(31),
    { view, source, proposal } = f
  const employeeRef = source.caseView.team.employees.find(
    (employee) => employee.role === 'product'
  )!.employeeRef
  for (const proposed of proposal.tasks) {
    proposed.requestedRole = 'product'
    proposed.outputKind = 'requirements'
  }
  source.draft.inspection = inspectWorkflowPlanProposal(proposal, source.draft.intent.facts)
  view.draft = source.draft
  view.application.draftDigest = digest(view.draft)
  view.application.proposalDigest = digest(proposal)
  view.graph!.draftDigest = view.application.draftDigest
  view.graph!.proposalDigest = view.application.proposalDigest
  for (const mapping of view.application.createdTaskRefs) {
    mapping.employeeRef = employeeRef
  }
  for (const task of view.tasks) {
    task.role = 'product'
    task.employeeRef = employeeRef
  }
  for (const run of view.runs) {
    run.role = 'product'
    run.employeeRef = employeeRef
  }
  for (const outcome of view.outcomes) {
    outcome.producer.role = 'product'
    outcome.producer.employeeRef = employeeRef
    delete outcome.review
    delete outcome.codeVersion
  }
  const sink = view.tasks[31]
  view.runs = view.runs.filter((run) => run.task.taskId !== sink.taskId)
  view.outcomes = view.outcomes.filter((outcome) => outcome.producer.task.taskId !== sink.taskId)
  const run = {
    ...f.admission.run,
    task: { ...f.admission.run.task, taskId: sink.taskId, runId: randomUUID() },
    employeeRef,
    role: 'product' as const,
    proposalTaskRef: sink.proposalTaskRef
  }
  view.runs.push(run)
  sink.latestRun = run.task
  sink.status = 'todo'
  sink.taskRevision = 1
  const validated = HiveWorkflowPlanGraphViewSchema.parse(view)
  const context = hiveWorkflowPlanGraphContext(
    source.caseView,
    validated,
    sink.proposalTaskRef,
    run.task
  )
  return { ...f, view: validated, context, task: run.task }
}
