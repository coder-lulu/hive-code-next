import type { ReactNode } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { normalizeExecutionHostId } from '../../../src/shared/execution-host'
import { firstParam } from './route-param-reader'
import { WorkspaceExecutionHostContext } from './workspace-execution-host'
import { PageRouteUnavailableScreen } from '../mobile-web-shell/PageRouteUnavailableScreen'
export function WorkspaceRoute({ children }: { children: ReactNode }) {
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    executionHost?: string | string[]
  }>()
  const hostId = firstParam(params.hostId)
  const executionHost = normalizeExecutionHostId(firstParam(params.executionHost)) ?? undefined
  if (executionHost?.startsWith('runtime:')) {
    return (
      <PageRouteUnavailableScreen hostId={hostId} message="请直接连接此工作区所属的 Runtime。" />
    )
  }
  return (
    <WorkspaceExecutionHostContext.Provider value={executionHost}>
      {children}
    </WorkspaceExecutionHostContext.Provider>
  )
}

/** Wraps a workspace route's default export so everything under it knows the workspace's server. */
export function withWorkspaceRoute(Screen: () => ReactNode): () => ReactNode {
  return function WorkspaceRouteScreen() {
    return (
      <WorkspaceRoute>
        <Screen />
      </WorkspaceRoute>
    )
  }
}
