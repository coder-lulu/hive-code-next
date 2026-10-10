import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import type { WorkflowRunBinding } from './task-workflow/workflow-bindings'
import type { WorkflowPlanDraft } from './task-workflow/workflow-plan-draft'
import type { WorkflowPlanIntent } from './task-workflow/workflow-plan-intent'

export const HIVE_WORKFLOW_PLAN_DRAFT_LIMIT = 3

type PlanCase = {
  binding: WorkflowRunBinding
  definitionDigest: string
  originTaskId: string
  stageTasks: readonly {
    stageRef: string
    taskId: string
    employeeRef: string
    role: string
  }[]
  workflow: { definition: { stages: readonly { stageRef: string; maxAttempts: number }[] } }
  planningIntent: WorkflowPlanIntent | null
  planDrafts: readonly WorkflowPlanDraft[]
}

/** Data consistency only; service readers must also join the original authenticated run and intent. */
export function workflowCasePlansMatch(view: PlanCase) {
  const intentMatches = (intent: WorkflowPlanIntent) => {
    const fixed = view.stageTasks.find((item) => item.stageRef === intent.stageRef)
    const stage = view.workflow.definition.stages.find((item) => item.stageRef === intent.stageRef)
    return (
      digest(intent.facts.binding) === digest(view.binding) &&
      intent.facts.definitionDigest === view.definitionDigest &&
      intent.facts.goalRef === view.originTaskId &&
      intent.sourceTask.spaceId === view.binding.scope.companyRef &&
      fixed?.role === 'product' &&
      fixed.taskId === intent.sourceTask.taskId &&
      fixed.employeeRef === intent.employeeRef &&
      stage !== undefined &&
      intent.sourceTask.attempt <= stage.maxAttempts
    )
  }
  return (
    (view.planningIntent === null || intentMatches(view.planningIntent)) &&
    new Set(view.planDrafts.map((draft) => draft.draftRef)).size === view.planDrafts.length &&
    new Set(view.planDrafts.map((draft) => draft.intent.intentRef)).size ===
      view.planDrafts.length &&
    new Set(view.planDrafts.map((draft) => draft.intent.facts.planRevision)).size ===
      view.planDrafts.length &&
    view.planDrafts.every((draft) => intentMatches(draft.intent))
  )
}
