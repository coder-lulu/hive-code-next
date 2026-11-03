import { normalizePairedServerRow } from '../../../../../../shared/sidebar-list/paired-server-rows'
import { describe, expect, it } from 'vitest'
import { repo, worktree } from '../../worktree-list-groups-test-fixtures'
import { EMPTY_SIDEBAR_FEED_DOMAINS } from '../../../../../../shared/sidebar-feed-client/sidebar-feed-snapshot'
import { buildWorkspaceRows } from '../../../../../../shared/sidebar-list/workspace-rows'
import {
  indexSidebarFeed,
  rankSidebarFeedWorktrees
} from '../../../../../../shared/sidebar-list/sidebar-feed-index'
import {
  planSidebarFeedRows,
  renderSidebarFeedRows,
  type SidebarFeedView
} from '../../../../../../shared/sidebar-list/sidebar-feed-rows'
import { NO_WORKSPACE_ROW_FILTERS } from '../../../../../../shared/workspace-view/workspace-row-filters'
import { getWorktreeHostIdentity } from '../../../../../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { renderOfflineFeedRows } from './render-offline-feed-rows'
import { OFFLINE_RUNTIME_GROUP_KEY } from '../grouping/group-keys'

function fixture() {
  const local: Worktree = { ...worktree, hostId: 'local', isArchived: false }
  const remote: Worktree = { ...local, hostId: 'runtime:remote' }
  const hidden: Worktree = { ...remote, id: `${remote.id}-archived`, isArchived: true }
  const repos = [repo, { ...repo, executionHostId: 'runtime:remote' as const }]
  const paired = normalizePairedServerRow('runtime:remote', {
    worktreeId: remote.id,
    repoId: remote.repoId,
    worktreeInstanceId: 'remote-generation'
  })
  if (!paired) {
    throw new Error('Invalid paired workspace fixture')
  }
  const domains = {
    ...EMPTY_SIDEBAR_FEED_DOMAINS,
    pairedServerHosts: new Map([['runtime:remote', { freshness: 'live' as const, host: null }]]),
    pairedServerRows: new Map([[paired.key, paired]]),
    workspaces: buildWorkspaceRows({
      worktrees: [local, hidden],
      folderWorkspaces: [],
      repos,
      lineageById: {}
    })
  }
  const view: SidebarFeedView = {
    groupBy: 'none',
    sortBy: 'recent',
    projectOrderBy: 'manual',
    collapsedGroups: new Set(),
    filters: NO_WORKSPACE_ROW_FILTERS,
    workspaceHostScope: 'all',
    visibleWorkspaceHostIds: null,
    workspaceStatuses: [],
    pinnedDisplayPolicy: 'single-location',
    defaultHostId: 'local',
    hostLabelOverrides: new Map(),
    localHostLabel: 'Local'
  }
  const index = indexSidebarFeed(domains, repos)
  const planned = planSidebarFeedRows(
    domains,
    index,
    { repos, projectGroups: [], projectGrouping: { projects: [], projectHostSetups: [] } },
    view,
    rankSidebarFeedWorktrees(index, view.sortBy)
  )
  return { planned, view, local, remote }
}

describe('main feed offline directory rendering', () => {
  it('partitions identical workspace ids by real owner after upstream visibility filters', () => {
    const { planned, view, local, remote } = fixture()
    const result = renderOfflineFeedRows(planned, view, new Set(), false, new Set(['remote']))
    const directory = result.sectionRows.findIndex(
      (row) => row.type === 'header' && row.key === OFFLINE_RUNTIME_GROUP_KEY
    )
    expect(directory).toBeGreaterThan(0)
    const identities = (rows: typeof result.sectionRows) =>
      rows.flatMap((row) => (row.type === 'item' ? [getWorktreeHostIdentity(row.worktree)] : []))
    expect(identities(result.sectionRows.slice(0, directory))).toEqual([
      getWorktreeHostIdentity(local)
    ])
    expect(identities(result.sectionRows.slice(directory + 1))).toEqual([
      getWorktreeHostIdentity(remote)
    ])
  })
  it('collapses only offline occurrences and rejoins shared output on reconnect', () => {
    const { planned, view, local } = fixture()
    const result = renderOfflineFeedRows(
      planned,
      view,
      new Set([OFFLINE_RUNTIME_GROUP_KEY]),
      false,
      new Set(['remote'])
    )
    expect(
      result.sectionRows.flatMap((row) =>
        row.type === 'item' ? [getWorktreeHostIdentity(row.worktree)] : []
      )
    ).toEqual([getWorktreeHostIdentity(local)])
    expect(renderOfflineFeedRows(planned, view, new Set(), false, new Set())).toEqual(
      renderSidebarFeedRows(planned, view, new Set(), false)
    )
  })
})
