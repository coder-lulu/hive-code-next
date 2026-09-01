import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId
} from '../../../../shared/execution-host'
import type {
  BuildDesktopHomeModelInput,
  DesktopHomeProjectHostSetup
} from './desktop-home-model-types'
import { normalizeHomeHostId } from './desktop-home-model-utils'

export type DesktopHomeProjectSetupIndex = {
  byRepoId: Map<string, DesktopHomeProjectHostSetup[]>
  byProjectId: Map<string, DesktopHomeProjectHostSetup[]>
}

/** Index setup metadata without turning each host setup into another project row. */
export function indexProjectHostSetups(
  setups: BuildDesktopHomeModelInput['projectHostSetups']
): DesktopHomeProjectSetupIndex {
  const byRepoId = new Map<string, DesktopHomeProjectHostSetup[]>()
  const byProjectId = new Map<string, DesktopHomeProjectHostSetup[]>()
  for (const setup of setups ?? []) {
    const executionHostId = normalizeHomeHostId(
      setup.executionHostId,
      setup.connectionId,
      normalizeExecutionHostId(setup.hostId) ?? LOCAL_EXECUTION_HOST_ID
    )
    const rows = byRepoId.get(setup.repoId) ?? []
    if (rows.some((row) => row.id === setup.id && row.executionHostId === executionHostId)) {
      continue
    }
    rows.push({
      id: setup.id,
      projectId: setup.projectId,
      repoId: setup.repoId,
      executionHostId,
      ...(setup.setupMethod ? { setupMethod: setup.setupMethod } : {}),
      ...(setup.kind ? { kind: setup.kind } : {}),
      ...(setup.setupState ? { setupState: setup.setupState } : {})
    })
    byRepoId.set(setup.repoId, rows)
    const projectRows = byProjectId.get(setup.projectId) ?? []
    const projected = rows.at(-1)!
    if (
      !projectRows.some(
        (row) => row.id === projected.id && row.executionHostId === projected.executionHostId
      )
    ) {
      projectRows.push(projected)
    }
    byProjectId.set(setup.projectId, projectRows)
  }
  return { byRepoId, byProjectId }
}
