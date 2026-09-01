import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import type {
  DesktopHomeProject,
  DesktopHomeProjectHostSetup,
  DesktopHomeProjectSource
} from './desktop-home-model-types'
import type { HomeRepo } from './desktop-home-model-utils'
import { sourceType, timestamp } from './desktop-home-model-utils'

function findProjectSource(
  sources: readonly DesktopHomeProjectSource[],
  repoId: string
): DesktopHomeProjectSource | undefined {
  return sources.find((project) => project.sourceRepoIds?.includes(repoId))
}

export function createProject(
  repo: HomeRepo,
  host: ExecutionHostId,
  projectSources: readonly DesktopHomeProjectSource[],
  setupByRepoId: ReadonlyMap<string, readonly DesktopHomeProjectHostSetup[]>,
  setupByProjectId?: ReadonlyMap<string, readonly DesktopHomeProjectHostSetup[]>,
  relatedRepos: readonly HomeRepo[] = [repo]
): DesktopHomeProject {
  const repoSetups = setupByRepoId.get(repo.id) ?? []
  const declared =
    findProjectSource(projectSources, repo.id) ??
    (repoSetups[0] && projectSources.find((project) => project.id === repoSetups[0].projectId))
  const projectId = declared?.id ?? repoSetups[0]?.projectId ?? repo.id
  // A Project is the logical development project, not a single checkout. Keep
  // every source repo that the catalog associates with it, but never pull a
  // checkout from another execution host into this row.
  const declaredRepoIds = new Set(declared?.sourceRepoIds ?? [repo.id])
  declaredRepoIds.add(repo.id)
  const repoIds = relatedRepos
    .filter((candidate) => {
      if (!declaredRepoIds.has(candidate.id)) {
        return false
      }
      // Host-qualified rows may share a logical project id, but each home row
      // represents one actionable host surface.
      return getRepoExecutionHostId(candidate) === host
    })
    .map((candidate) => candidate.id)
  if (!repoIds.includes(repo.id)) {
    repoIds.unshift(repo.id)
  }
  const relatedProjectRepos = relatedRepos.filter((candidate) => repoIds.includes(candidate.id))
  const hostSetups = [...(setupByProjectId?.get(projectId) ?? repoSetups)]
  const setup = hostSetups.find((entry) => entry.executionHostId === host) ?? hostSetups[0]
  const projectGroupId =
    repo.projectGroupId ??
    relatedProjectRepos.find((candidate) => candidate.projectGroupId)?.projectGroupId ??
    null
  const lastActivityAt = relatedProjectRepos.reduce(
    (latest, candidate) => Math.max(latest, timestamp(candidate.addedAt)),
    timestamp(repo.addedAt)
  )
  const badgeColor =
    repo.badgeColor ??
    relatedProjectRepos.find((candidate) => candidate.badgeColor)?.badgeColor ??
    null
  return {
    id: projectId,
    identityKey: `${host}|project:${projectId}`,
    name: declared?.displayName ?? repo.displayName,
    repoIds,
    repoId: repo.id,
    projectGroupId,
    sourceType: sourceType(repo, host),
    sessions: [],
    workspaces: [],
    workspaceCount: 0,
    lastActivityAt,
    badgeColor,
    executionHostId: host,
    ...(hostSetups.length > 0 ? { hostSetups } : {}),
    ...(setup?.setupState ? { setupState: setup.setupState } : {})
  }
}
