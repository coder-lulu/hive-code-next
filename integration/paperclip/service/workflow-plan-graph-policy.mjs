import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'

import { readWorkbenchTeam } from './team-workbench-repository-records.mjs'

export function planGraphTopologyReason(proposal) {
  const ancestors = (task, seen = new Set()) => {
    for (const ref of task.dependsOn) {
      if (!seen.has(ref)) {
        seen.add(ref)
        ancestors(
          proposal.tasks.find((item) => item.taskRef === ref),
          seen
        )
      }
    }
    return seen
  }
  for (const task of proposal.tasks) {
    const parents = ancestors(task)
    const developers = proposal.tasks.filter(
      (item) => item.requestedRole === 'developer' && parents.has(item.taskRef)
    )
    if (developers.length > 1) {
      return 'unsupported_graph'
    }
    if (
      task.requestedRole === 'tester' &&
      (developers.length !== 1 || !task.dependsOn.includes(developers[0].taskRef))
    ) {
      return 'unsupported_graph'
    }
    if (task.requestedRole === 'ops') {
      const testers = proposal.tasks.filter(
        (item) => item.requestedRole === 'tester' && task.dependsOn.includes(item.taskRef)
      )
      if (
        developers.length !== 1 ||
        testers.length !== 1 ||
        !testers[0].dependsOn.includes(developers[0].taskRef)
      ) {
        return 'unsupported_graph'
      }
    }
    if (
      task.requestedRole === 'developer' &&
      !proposal.tasks.some(
        (item) => item.requestedRole === 'tester' && item.dependsOn.includes(task.taskRef)
      )
    ) {
      return 'independent_review_required'
    }
    if (
      task.requestedRole === 'developer' &&
      proposal.tasks.filter(
        (item) => item.requestedRole === 'tester' && item.dependsOn.includes(task.taskRef)
      ).length !== 1
    ) {
      return 'unsupported_graph'
    }
  }
  return null
}

export async function planGraphAvailability(db, accountId, source, graph) {
  const { project, view, draft } = source,
    proposal = draft.inspection.proposal
  if (view.terminalKind === 'cancelled') {
    return 'source_case_cancelled'
  }
  if (view.terminalKind !== 'done') {
    return 'source_busy'
  }
  if (digest(project.binding) !== digest(view.team.project)) {
    return 'project_binding_changed'
  }
  const team = await readWorkbenchTeam(db, accountId, project.id)
  if (
    digest(team.company.binding) !== digest(view.team.company) ||
    digest(
      team.employees.map((item) => item.binding).sort((a, b) => a.role.localeCompare(b.role))
    ) !== digest([...view.team.employees].sort((a, b) => a.role.localeCompare(b.role)))
  ) {
    return 'role_unavailable'
  }
  const [company] = await db`SELECT status FROM companies WHERE id=${project.companyId} FOR SHARE`
  const agents =
    await db`SELECT id,status FROM agents WHERE company_id=${project.companyId} AND id=ANY(${view.team.employees.map((item) => item.employeeRef)}::uuid[]) FOR SHARE`
  if (
    company?.status !== 'active' ||
    agents.length !== 4 ||
    agents.some((item) => !['idle', 'running', 'error'].includes(item.status))
  ) {
    return 'role_unavailable'
  }
  const ids = [view.originTaskId, ...view.stageTasks.map((item) => item.taskId)]
  const busy =
    await db`SELECT id FROM issues WHERE id=ANY(${ids}::uuid[]) AND (checkout_run_id IS NOT NULL OR execution_run_id IS NOT NULL OR execution_locked_at IS NOT NULL) LIMIT 1 FOR SHARE`
  const active =
    await db`SELECT b.run_id FROM hive_task_bindings b JOIN heartbeat_runs h ON h.id=b.run_id WHERE b.task_id=ANY(${ids}::uuid[]) AND b.account_id=${accountId} AND b.result_receipt IS NULL AND (h.status IN ('queued','running') OR h.execution_stage IS DISTINCT FROM 'settled') LIMIT 1 FOR SHARE OF b,h`
  if (busy.length || active.length) {
    return 'source_busy'
  }
  if (proposal.resourceSelectionRefs?.length || proposal.requiredCoverage) {
    return 'resource_loading_unavailable'
  }
  if (proposal.knowledgeRequirements?.some((item) => item.required)) {
    return 'knowledge_access_unavailable'
  }
  if (proposal.requestedLimits.budget) {
    return 'hard_budget_unavailable'
  }
  const unsupported = planGraphTopologyReason(proposal)
  if (unsupported) {
    return unsupported
  }
  if (graph) {
    if (['cancelled', 'cancel_requested'].includes(graph.status)) {
      return 'graph_cancelled'
    }
    if (graph.status === 'paused') {
      return 'graph_paused'
    }
    const [clock] = await db`SELECT clock_timestamp() AS now`
    if (graph.status !== 'done' && clock.now.getTime() >= Date.parse(graph.deadlineAt)) {
      return 'deadline_exceeded'
    }
  }
  return null
}
