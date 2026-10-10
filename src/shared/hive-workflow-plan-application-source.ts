import type { HiveWorkflowPlanApplicationReceipt } from './hive-workflow-plan-application'
import type { WorkflowPlanDraft } from './task-workflow/workflow-plan-draft'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'

/** Consistency only: callers supply the original draft from authorized storage. */
export function workflowPlanApplicationMatchesDraft(
  receipt: HiveWorkflowPlanApplicationReceipt,
  draft: WorkflowPlanDraft
) {
  if (
    draft.inspection.kind !== 'validated' ||
    receipt.draftRef !== draft.draftRef ||
    receipt.draftDigest !== digest(draft) ||
    receipt.planRevision !== draft.intent.facts.planRevision ||
    receipt.proposalDigest !== digest(draft.inspection.proposal) ||
    digest(receipt.binding) !== digest(draft.intent.facts.binding) ||
    receipt.parentTaskRef !== draft.intent.facts.goalRef
  ) {
    return false
  }
  const mappings = new Map(receipt.createdTaskRefs.map((task) => [task.proposalTaskRef, task]))
  return (
    mappings.size === receipt.createdTaskRefs.length &&
    mappings.size === draft.inspection.proposal.tasks.length &&
    draft.inspection.proposal.tasks.every((task) => {
      const mapped = mappings.get(task.taskRef)
      return (
        mapped !== undefined &&
        digest({ ids: [...mapped.dependsOnTaskIds].sort() }) ===
          digest({ ids: task.dependsOn.map((ref) => mappings.get(ref)?.taskId).sort() })
      )
    })
  )
}
