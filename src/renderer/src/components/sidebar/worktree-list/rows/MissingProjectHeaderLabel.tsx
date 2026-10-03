import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'

export function MissingProjectHeaderLabel({ repoId }: { repoId: string }) {
  const { t } = useTranslation()
  const status = useAppStore((state) => {
    const hosts = new Set(
      (state.worktreesByRepo[repoId] ?? []).map((worktree) =>
        worktree.runtimeOwnerEnvironmentId
          ? `runtime:${worktree.runtimeOwnerEnvironmentId}`
          : worktree.hostId
      )
    )
    const statuses = [...hosts].flatMap((host) =>
      host ? [state.repoCatalogStatusByHost[host]] : []
    )
    if (statuses.includes('loading')) {
      return 'loading'
    }
    if (statuses.includes('unavailable')) {
      return 'unavailable'
    }
    return 'unknown'
  })
  if (status === 'loading') {
    return t('sidebar.projectSyncing', 'Syncing projects…')
  }
  if (status === 'unavailable') {
    return t('sidebar.projectHostUnavailable', 'Project catalog unavailable')
  }
  return t('sidebar.projectInfoUnavailable', 'Project information unavailable')
}
