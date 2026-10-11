import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  HiveWorkbenchCompanyPageSchema,
  HiveWorkbenchProjectPageSchema,
  HiveWorkbenchTeamSchema
} from '../../shared/hive-team-workbench'
import { HiveWorkflowPageSchema } from '../../shared/hive-task-workflows'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import type { HiveTeamTaskToolOptions } from './hive-team-task-tool-ports'
import { assertHiveWorkbenchCompanyOwner } from './hive-team-workbench-facade'
import { refuseTaskExecution } from './task-execution-error'

export const TeamToolScopeSchema = z.strictObject({
  ownerDigest: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceRef: z.string().min(1).max(160),
  companyId: z.string().uuid(),
  companyRevision: z.number().int().positive(),
  projectId: z.string().uuid(),
  projectRevision: z.number().int().positive(),
  workflowId: z.string().uuid(),
  workflowRevision: z.number().int().positive(),
  definitionDigest: z.string().regex(/^[a-f0-9]{64}$/)
})
export type TeamToolScope = z.infer<typeof TeamToolScopeSchema>
export const teamToolHash = (value: string) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function teamToolOwner(options: HiveTeamTaskToolOptions) {
  options.assertCurrent()
  const account = options.currentAccount()
  const runtime = options.currentRuntime()
  if (
    !account ||
    !runtime ||
    account.sessionExpiresAt <= Date.now() ||
    runtime.accountId !== account.accountId
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  return {
    accountRef: `account:${teamToolHash(account.accountId)}`,
    ownerDigest: digest({
      accountId: account.accountId,
      authorityId: account.authorityId,
      sessionGeneration: account.sessionGeneration,
      runtimeRecordId: runtime.runtimeRecordId,
      ownershipEpoch: runtime.ownershipEpoch
    })
  }
}

export async function resolveTeamToolScope(
  options: HiveTeamTaskToolOptions,
  selector: string,
  assertCurrent: () => void
): Promise<TeamToolScope> {
  assertCurrent()
  const owner = teamToolOwner(options)
  const source = await options.resolveWorkspaceSource(selector)
  const check = () => {
    assertCurrent()
    source.assertCurrent()
  }
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    check()
    const value = await operation()
    check()
    return value
  }
  check()
  const workspaceRef = `workspace:${teamToolHash(source.path)}`
  const companies = HiveWorkbenchCompanyPageSchema.parse(
    await read(() => options.facade.listCompanies({ limit: 50 }))
  )
  if (companies.nextCursor !== null) {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  const matches: {
    company: (typeof companies.items)[number]
    project: z.infer<typeof HiveWorkbenchProjectPageSchema>['items'][number]
  }[] = []
  for (const company of companies.items) {
    assertHiveWorkbenchCompanyOwner(company.binding, owner.accountRef)
    const projects = HiveWorkbenchProjectPageSchema.parse(
      await read(() => options.facade.listProjects({ companyId: company.id, limit: 50 }))
    )
    if (projects.nextCursor !== null) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    for (const project of projects.items) {
      if (project.companyId !== company.id) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      if (project.binding.hiveWorkspaceRef === workspaceRef) {
        matches.push({ company, project })
      }
    }
  }
  if (matches.length !== 1) {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  const { company, project } = matches[0]
  const team = HiveWorkbenchTeamSchema.parse(await read(() => options.facade.getTeam(project.id)))
  if (team.employees.length !== 4) {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  if (digest(team.company) !== digest(company) || digest(team.project) !== digest(project)) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  const workflows = HiveWorkflowPageSchema.parse(
    await read(() => options.facade.listWorkflows({ projectId: project.id, limit: 50 }))
  )
  if (workflows.nextCursor !== null || workflows.items.length !== 1) {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  const workflow = workflows.items[0]
  if (
    workflow.definition.scope.companyRef !== company.id ||
    workflow.definition.scope.projectRef !== project.id ||
    workflow.projectBindingRevision !== project.binding.bindingRevision
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  check()
  return TeamToolScopeSchema.parse({
    ownerDigest: owner.ownerDigest,
    workspaceRef,
    companyId: company.id,
    companyRevision: company.binding.bindingRevision,
    projectId: project.id,
    projectRevision: project.binding.bindingRevision,
    workflowId: workflow.workflowId,
    workflowRevision: workflow.definition.workflowRevision,
    definitionDigest: workflow.definitionDigest
  })
}
