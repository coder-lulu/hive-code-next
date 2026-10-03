import type {
  HiveWorkbenchCompanyPage,
  HiveWorkbenchProjectPage,
  HiveWorkbenchTeam
} from '../../../../../shared/hive-team-workbench'

export type PendingOperation =
  | 'companies'
  | 'projects'
  | 'team'
  | 'createCompany'
  | 'createProject'
  | 'configureTeam'
export type HiveWorkbenchState = {
  companies: HiveWorkbenchCompanyPage
  projects: HiveWorkbenchProjectPage
  companyId: string | null
  projectId: string | null
  team: HiveWorkbenchTeam | null
  error: string | null
  pending: PendingOperation | null
  accountRevision: number
  companiesRevision: number
  projectsRevision: number
}
export type HiveWorkbenchAct = <T>(
  name: PendingOperation,
  operation: () => Promise<T>,
  receive: (value: T) => void
) => Promise<boolean>
export function emptyHiveWorkbenchState(accountRevision = 0): HiveWorkbenchState {
  return {
    companies: { items: [], nextCursor: null },
    projects: { items: [], nextCursor: null },
    companyId: null,
    projectId: null,
    team: null,
    error: null,
    pending: null,
    accountRevision,
    companiesRevision: 0,
    projectsRevision: 0
  }
}
export function appendWorkbenchRows<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  const rows = new Map(previous.map((row) => [row.id, row]))
  incoming.forEach((row) => rows.set(row.id, row))
  return [...rows.values()]
}
