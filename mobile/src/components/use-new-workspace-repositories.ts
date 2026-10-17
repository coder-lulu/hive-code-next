import { useEffect, useMemo, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { getCachedRepos, setCachedRepos } from '../cache/repo-cache'
import { listHostRepos } from '../worktree/server-repos'
import { useLastVisitedWorktreeRepoId } from '../worktree/use-last-visited-worktree-repo'
import {
  getMobileNewWorkspaceDialogEligibleRepos,
  refreshMobileNewWorkspaceDialogSelectedRepo,
  resolveMobileNewWorkspaceDialogRepoId
} from '../worktree/new-workspace-dialog-repo-selection'
import type { MobileWorkspaceRepo } from './new-worktree-modal-types'

export function useNewWorkspaceRepositories(args: {
  client: RpcClient | null
  hostId?: string
  visible: boolean
}): {
  repos: MobileWorkspaceRepo[]
  selectedRepo: MobileWorkspaceRepo | null
  setSelectedRepo: (repo: MobileWorkspaceRepo | null) => void
  loading: boolean
  selectionError: string
} {
  const { client, hostId, visible } = args
  const [initialRepos] = useState(() =>
    hostId ? (getCachedRepos(hostId) as MobileWorkspaceRepo[] | null) : null
  )
  const [listedRepos, setRepos] = useState<MobileWorkspaceRepo[]>(initialRepos ?? [])
  const [pickedRepo, setSelectedRepo] = useState<MobileWorkspaceRepo | null>(null)
  const [loading, setLoading] = useState(initialRepos == null)
  const lastVisitedRepo = useLastVisitedWorktreeRepoId(hostId, visible)
  const repos = useMemo(
    () => listedRepos.filter((repo) => !repo.executionHostId?.startsWith('runtime:')),
    [listedRepos]
  )
  const retiredSelection = pickedRepo
    ? pickedRepo.executionHostId?.startsWith('runtime:')
    : [...(initialRepos ?? []), ...listedRepos].some(
        (repo) => repo.id === lastVisitedRepo.repoId && repo.executionHostId?.startsWith('runtime:')
      )
  const selectionError = retiredSelection
    ? '所选仓库需要直接连接所属 Runtime，请重新选择仓库。'
    : ''
  // Why derived: the pick follows its repo's latest listing, and goes once its host stops listing it.
  const selectedRepo = useMemo(
    () => refreshMobileNewWorkspaceDialogSelectedRepo(repos, pickedRepo),
    [pickedRepo, repos]
  )

  useEffect(() => {
    if (
      !visible ||
      !lastVisitedRepo.loaded ||
      selectedRepo ||
      retiredSelection ||
      repos.length === 0
    ) {
      return
    }
    const eligibleRepos = getMobileNewWorkspaceDialogEligibleRepos(repos)
    const preferredRepoId = resolveMobileNewWorkspaceDialogRepoId({
      eligibleRepos,
      activeRepoId: lastVisitedRepo.repoId
    })
    const preferredRepo = repos.find((repo) => repo.id === preferredRepoId) ?? null
    if (preferredRepo) {
      setSelectedRepo(preferredRepo)
    }
  }, [
    lastVisitedRepo.loaded,
    lastVisitedRepo.repoId,
    repos,
    retiredSelection,
    selectedRepo,
    visible
  ])

  useEffect(() => {
    if (!visible || !client) {
      return
    }
    let stale = false
    setLoading(true)
    void listHostRepos<MobileWorkspaceRepo>(client)
      .then((listed) => {
        if (stale || !listed) {
          return
        }
        setRepos(listed)
        if (hostId) {
          setCachedRepos(hostId, listed)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!stale) {
          setLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [visible, client, hostId])

  return {
    repos,
    selectedRepo,
    setSelectedRepo,
    loading: loading && repos.length === 0,
    selectionError
  }
}
