import { refuseWorkbench as refuse } from './team-workbench-repository-records.mjs'

/** Original Drizzle readers run on this exact postgres-js transaction, without changing its parsers. */
export async function requireWorkflowIssueCheckout(db, task, runId) {
  const [
    { PgDatabase, PgDialect },
    { PostgresJsSession },
    ownership,
    pause,
    dependencies,
    eligibility
  ] = await Promise.all([
    import('@hive-paperclip-drizzle-pg'),
    import('@hive-paperclip-drizzle-session'),
    import('../core/issue-checkout-ownership.ts'),
    import('../core/issue-checkout-admission.ts'),
    import('../core/issue-dependency-readiness.ts'),
    import('@hive-paperclip-agent-eligibility')
  ])
  const dialect = new PgDialect()
  const reader = new PgDatabase(dialect, new PostgresJsSession(db, dialect, undefined))
  const [company] = await db`SELECT status,budget_monthly_cents,spent_monthly_cents
    FROM companies WHERE id=${task.company_id} FOR SHARE`
  const members =
    await db`SELECT id,company_id AS "companyId",name,status,reports_to AS "reportsTo",
    budget_monthly_cents,spent_monthly_cents FROM agents WHERE company_id=${task.company_id} FOR SHARE`
  const agent = members.find((member) => member.id === task.agent_id)
  if (
    !company ||
    company.status !== 'active' ||
    !agent ||
    !eligibility.getAgentWorkEligibility({ agent, agents: members }).invokable ||
    (company.budget_monthly_cents > 0 &&
      company.spent_monthly_cents >= company.budget_monthly_cents) ||
    (agent.budget_monthly_cents > 0 && agent.spent_monthly_cents >= agent.budget_monthly_cents)
  ) {
    refuse('FORBIDDEN')
  }
  if (await pause.getActivePauseHoldGate(reader, task.company_id, task.id)) {
    refuse('REVISION_CONFLICT')
  }
  const readiness = await dependencies.listIssueDependencyReadinessMap(reader, task.company_id, [
    task.id
  ])
  if (!readiness.get(task.id)?.isDependencyReady) {
    refuse('REVISION_CONFLICT')
  }
  const predicate = dialect.sqlToQuery(
    ownership.issueCheckoutOwnershipCondition(task.agent_id, runId)
  )
  const scope = predicate.params.length
  const [owned] = await db.unsafe(
    `SELECT ${predicate.sql} AS owned FROM issues
    WHERE company_id=$${scope + 1} AND id=$${scope + 2} FOR UPDATE`,
    [...predicate.params, task.company_id, task.id]
  )
  if (owned?.owned !== true) {
    refuse('REVISION_CONFLICT')
  }
}
