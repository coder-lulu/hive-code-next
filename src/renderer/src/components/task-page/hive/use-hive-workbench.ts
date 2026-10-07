import { useCallback, useEffect, useRef, useState } from 'react'
import {
  appendWorkbenchRows,
  emptyHiveWorkbenchState,
  type PendingOperation
} from './hive-workbench-state'
import { createHiveWorkbenchMutations } from './hive-workbench-mutations'
import { subscribeHiveUiAccountBoundary } from './hive-ui-account-boundary'

export function useHiveWorkbench() {
  const [state, setState] = useState(emptyHiveWorkbenchState)
  const generation = useRef(0)
  const mounted = useRef(false)
  const flight = useRef<object | null>(null)
  const requests = useRef(new Map<string, { signature: string; id: string }>())
  const act = useCallback(
    async <T>(name: PendingOperation, operation: () => Promise<T>, receive: (value: T) => void) => {
      if (!mounted.current || flight.current) {
        return false
      }
      const token = {}
      const epoch = generation.current
      flight.current = token
      setState((previous) => ({ ...previous, pending: name, error: null }))
      try {
        const value = await Promise.resolve().then(() => {
          if (!mounted.current || generation.current !== epoch || flight.current !== token) {
            throw new Error('STALE_REQUEST')
          }
          return operation()
        })
        if (!mounted.current || generation.current !== epoch || flight.current !== token) {
          return false
        }
        receive(value)
        return true
      } catch (failure) {
        if (mounted.current && generation.current === epoch && flight.current === token) {
          setState((previous) => ({
            ...previous,
            error: failure instanceof Error ? failure.message : 'SERVICE_UNAVAILABLE'
          }))
        }
        return false
      } finally {
        if (mounted.current && flight.current === token) {
          flight.current = null
          setState((previous) => ({ ...previous, pending: null }))
        }
      }
    },
    []
  )
  const loadCompanies = useCallback(
    (after?: string) =>
      act(
        'companies',
        () => window.api.hiveTasks.listCompanies({ after }),
        (page) => {
          setState((previous) => {
            if (after) {
              return {
                ...previous,
                companies: {
                  ...page,
                  items: appendWorkbenchRows(previous.companies.items, page.items)
                }
              }
            }
            const selectedCompany = previous.companies.items.find(
              (company) => company.id === previous.companyId
            )
            // A paginated first page cannot prove the selected row was removed.
            const items =
              page.nextCursor &&
              selectedCompany &&
              !page.items.some((company) => company.id === selectedCompany.id)
                ? appendWorkbenchRows(page.items, [selectedCompany])
                : page.items
            const companyId = items.some((company) => company.id === previous.companyId)
              ? previous.companyId
              : (page.items[0]?.id ?? null)
            const sameCompany = companyId !== null && companyId === previous.companyId
            return {
              ...previous,
              companies: { ...page, items },
              companyId,
              projects: sameCompany ? previous.projects : { items: [], nextCursor: null },
              projectId: sameCompany ? previous.projectId : null,
              team: sameCompany ? previous.team : null,
              companiesRevision: previous.companiesRevision + 1
            }
          })
        }
      ),
    [act]
  )
  useEffect(() => {
    const requestCache = requests.current
    mounted.current = true
    void loadCompanies()
    const unsubscribe = subscribeHiveUiAccountBoundary(() => {
      generation.current += 1
      flight.current = null
      requestCache.clear()
      setState((previous) => emptyHiveWorkbenchState(previous.accountRevision + 1))
      void loadCompanies()
    })
    return () => {
      unsubscribe()
      mounted.current = false
      generation.current += 1
      flight.current = null
      requestCache.clear()
    }
  }, [loadCompanies])

  const loadProjects = useCallback(
    (after?: string) => {
      if (!state.companyId) {
        return Promise.resolve(false)
      }
      const companyId = state.companyId
      return act(
        'projects',
        () => window.api.hiveTasks.listProjects({ companyId, after }),
        (page) => {
          setState((previous) => {
            if (after) {
              return {
                ...previous,
                projects: {
                  ...page,
                  items: appendWorkbenchRows(previous.projects.items, page.items)
                }
              }
            }
            const selectedProject = previous.projects.items.find(
              (project) => project.id === previous.projectId
            )
            const items =
              page.nextCursor &&
              selectedProject &&
              !page.items.some((project) => project.id === selectedProject.id)
                ? appendWorkbenchRows(page.items, [selectedProject])
                : page.items
            const projectId = items.some((project) => project.id === previous.projectId)
              ? previous.projectId
              : (page.items[0]?.id ?? null)
            return {
              ...previous,
              projects: { ...page, items },
              projectId,
              team: projectId !== null && projectId === previous.projectId ? previous.team : null,
              projectsRevision: previous.projectsRevision + 1
            }
          })
        }
      )
    },
    [act, state.companyId]
  )
  useEffect(() => {
    if (state.companyId) {
      void loadProjects()
    }
  }, [state.companyId, state.companiesRevision, loadProjects])
  const loadTeam = useCallback(() => {
    if (!state.projectId) {
      return Promise.resolve(false)
    }
    const projectId = state.projectId
    return act(
      'team',
      () => window.api.hiveTasks.getTeam(projectId),
      (team) =>
        setState((previous) => ({
          ...previous,
          // Equal bridge DTOs retain the dependent editors' pending requests and retry IDs.
          team: JSON.stringify(team) === JSON.stringify(previous.team) ? previous.team : team
        }))
    )
  }, [act, state.projectId])
  useEffect(() => {
    if (state.projectId) {
      void loadTeam()
    }
  }, [state.projectId, state.projectsRevision, loadTeam])

  const invalidateSelection = () => {
    generation.current += 1
    flight.current = null
  }
  return {
    ...state,
    busy: state.pending !== null,
    selectedCompany:
      state.companies.items.find((company) => company.id === state.companyId) ?? null,
    selectedProject: state.projects.items.find((project) => project.id === state.projectId) ?? null,
    refresh: () => loadCompanies(),
    retryProjects: () => loadProjects(),
    retryTeam: loadTeam,
    loadMoreCompanies: () =>
      state.companies.nextCursor
        ? loadCompanies(state.companies.nextCursor)
        : Promise.resolve(false),
    loadMoreProjects: () =>
      state.projects.nextCursor ? loadProjects(state.projects.nextCursor) : Promise.resolve(false),
    selectCompany: (companyId: string) => {
      if (!state.companies.items.some((company) => company.id === companyId)) {
        return
      }
      invalidateSelection()
      setState((previous) => ({
        ...previous,
        companyId,
        projects: { items: [], nextCursor: null },
        projectId: null,
        team: null,
        error: null,
        pending: null,
        companiesRevision: previous.companiesRevision + 1
      }))
    },
    selectProject: (projectId: string) => {
      if (!state.projects.items.some((project) => project.id === projectId)) {
        return
      }
      invalidateSelection()
      setState((previous) => ({
        ...previous,
        projectId,
        team: null,
        error: null,
        pending: null,
        projectsRevision: previous.projectsRevision + 1
      }))
    },
    ...createHiveWorkbenchMutations(act, setState, generation, requests)
  }
}
export type HiveWorkbenchModel = ReturnType<typeof useHiveWorkbench>
