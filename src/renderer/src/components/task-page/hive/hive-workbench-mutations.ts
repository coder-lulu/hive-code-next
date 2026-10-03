import type { Dispatch, SetStateAction } from 'react'
import type {
  HiveWorkbenchCompanyCreate,
  HiveWorkbenchProjectCreate,
  HiveWorkbenchTeamConfigure
} from '../../../../../shared/hive-team-workbench'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  appendWorkbenchRows,
  type HiveWorkbenchAct,
  type HiveWorkbenchState
} from './hive-workbench-state'

export function createHiveWorkbenchMutations(
  act: HiveWorkbenchAct,
  setState: Dispatch<SetStateAction<HiveWorkbenchState>>,
  generation: { current: number },
  requests: { current: Map<string, { signature: string; id: string }> }
) {
  const requestId = (name: string, input: unknown) => {
    const signature = JSON.stringify(input)
    const existing = requests.current.get(name)
    if (existing?.signature === signature) {
      return existing.id
    }
    const id = createBrowserUuid()
    requests.current.set(name, { signature, id })
    return id
  }
  const mutate = async <T>(
    name: 'createCompany' | 'createProject' | 'configureTeam',
    input: unknown,
    operation: (id: string) => Promise<T>,
    receive: (value: T) => void
  ) => {
    const epoch = generation.current
    const success = await act(name, () => operation(requestId(name, input)), receive)
    if (generation.current !== epoch) {
      return false
    }
    if (success) {
      requests.current.delete(name)
    }
    return success
  }
  return {
    createCompany: (input: Omit<HiveWorkbenchCompanyCreate, 'requestId'>) => {
      const normalized = { name: input.name.trim() }
      return mutate(
        'createCompany',
        normalized,
        (id) => window.api.hiveTasks.createCompany({ ...normalized, requestId: id }),
        (company) =>
          setState((previous) => ({
            ...previous,
            companies: {
              ...previous.companies,
              items: appendWorkbenchRows(previous.companies.items, [company])
            },
            companyId: company.id,
            projects: { items: [], nextCursor: null },
            projectId: null,
            team: null,
            companiesRevision: previous.companiesRevision + 1
          }))
      )
    },
    createProject: (input: Omit<HiveWorkbenchProjectCreate, 'requestId'>) => {
      const normalized = { ...input, name: input.name.trim() }
      return mutate(
        'createProject',
        normalized,
        (id) => window.api.hiveTasks.createProject({ ...normalized, requestId: id }),
        (project) =>
          setState((previous) => ({
            ...previous,
            projects: {
              ...previous.projects,
              items: appendWorkbenchRows(previous.projects.items, [project])
            },
            projectId: project.id,
            team: null,
            projectsRevision: previous.projectsRevision + 1
          }))
      )
    },
    configureTeam: (input: Omit<HiveWorkbenchTeamConfigure, 'requestId'>) => {
      const normalized = {
        ...input,
        employees: input.employees.map((employee) => ({ ...employee, name: employee.name.trim() }))
      }
      return mutate(
        'configureTeam',
        normalized,
        (id) => window.api.hiveTasks.configureTeam({ ...normalized, requestId: id }),
        (team) =>
          setState((previous) => ({
            ...previous,
            team,
            projects: {
              ...previous.projects,
              items: previous.projects.items.map((project) =>
                project.id === team.project.id ? team.project : project
              )
            }
          }))
      )
    }
  }
}
