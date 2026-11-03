import {
  renderSidebarFeedRows,
  type SidebarFeedPlan,
  type SidebarFeedView
} from '../../../../../../shared/sidebar-list/sidebar-feed-rows'
import { addHostSectionRows } from '../../../../../../shared/sidebar-list/host-section-rows'
import {
  deferHostSectionCollapse,
  scopeHostSectionCollapse
} from '../../../../../../shared/sidebar-list/host-section-collapse'
import {
  appendRuntimeOfflineDirectory,
  buildRuntimeOfflineRows
} from '../grouping/runtime-offline-rows'

export function renderOfflineFeedRows(
  planned: SidebarFeedPlan,
  view: SidebarFeedView,
  collapsedGroups: ReadonlySet<string>,
  forceCollapseHosts: boolean,
  offlineEnvironmentIds: ReadonlySet<string>
) {
  if (!offlineEnvironmentIds.size) {
    return renderSidebarFeedRows(planned, view, collapsedGroups, forceCollapseHosts)
  }
  const collapsed = new Set(collapsedGroups)
  const partition = buildRuntimeOfflineRows(
    planned.rowInputs,
    offlineEnvironmentIds,
    planned.hostScoped ? deferHostSectionCollapse(collapsed) : collapsed
  )
  const sectioned = addHostSectionRows({
    rows: partition.onlineRows,
    hostOptions: planned.orderedHostOptions,
    workspaceHostScope: view.workspaceHostScope,
    visibleWorkspaceHostIds: view.visibleWorkspaceHostIds,
    defaultHostId: view.defaultHostId,
    localHostLabel: view.localHostLabel,
    collapsedHostKeys: collapsed,
    forceCollapseHosts,
    preferProjectGrouping: true
  })
  const onlineRows = planned.hostScoped
    ? scopeHostSectionCollapse({ rows: sectioned, collapsedGroups: collapsed })
    : sectioned
  return {
    rows: partition.onlineRows,
    sectionRows: appendRuntimeOfflineDirectory(
      onlineRows,
      partition.offlineRows,
      partition.offlineCount,
      collapsed
    )
  }
}
