import type { HiveAccountState } from '../../../../../shared/hive-account'
import type {
  HiveWorkbenchCompany,
  HiveWorkbenchProject,
  HiveWorkbenchTeam
} from '../../../../../shared/hive-team-workbench'

export function workbenchAccountState(
  accountId = 'workbench-owner',
  authorityId = 'workbench-authority'
): HiveAccountState {
  return {
    configured: true,
    status: 'signed-in',
    persistence: 'encrypted',
    account: { accountId, displayName: 'Workbench owner' },
    authorityId,
    sessionProfile: 'TRUSTED',
    expiresAt: Date.now() + 3_600_000,
    sessionExpiresAt: Date.now() + 86_400_000
  }
}

export function workbenchId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
}
export function workbenchCompany(value: number): HiveWorkbenchCompany {
  const id = workbenchId(value)
  return {
    id,
    name: `Private company ${value}`,
    binding: {
      contractVersion: 1,
      kind: 'workflow.company-binding',
      companyRef: id,
      ownerScope: { kind: 'personalTenant', tenantRef: 'account:test' },
      ownerAccountRef: 'account:test',
      ownerActorRef: 'actor:test',
      bindingRevision: 1
    }
  }
}
export function workbenchProject(
  value: number,
  company: HiveWorkbenchCompany
): HiveWorkbenchProject {
  const id = workbenchId(value)
  return {
    id,
    companyId: company.id,
    name: `Private project ${value}`,
    workspaceSelector: 'folder:local',
    binding: {
      contractVersion: 1,
      kind: 'workflow.project-binding',
      scope: { companyRef: company.id, projectRef: id },
      hiveWorkspaceRef: 'workspace:test',
      bindingRevision: 1
    }
  }
}
export function workbenchTeam(
  company: HiveWorkbenchCompany,
  project: HiveWorkbenchProject,
  configured = false
): HiveWorkbenchTeam {
  return {
    company,
    project,
    employees: configured
      ? (['product', 'developer', 'tester', 'ops'] as const).map((role, index) => ({
          name: `Private ${role}`,
          binding: {
            contractVersion: 1,
            kind: 'workflow.employee-binding',
            scope: project.binding.scope,
            employeeRef: workbenchId(index + 20),
            role,
            adapterType: 'hive_runtime',
            executor: 'codex',
            profileRef: 'codex',
            profileRevision: 'codex:1',
            bindingRevision: project.binding.bindingRevision
          }
        }))
      : [],
    executionAvailability: {
      available: false,
      reason: configured ? 'EXECUTION_ISOLATION_UNAVAILABLE' : 'TEAM_NOT_CONFIGURED'
    }
  }
}
export function deferredWorkbenchValue<T>() {
  let resolve!: (value: T) => void
  let reject!: (failure: Error) => void
  const promise = new Promise<T>((receive, fail) => {
    resolve = receive
    reject = fail
  })
  return { promise, resolve, reject }
}
