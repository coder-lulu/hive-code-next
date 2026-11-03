import { encodeGitPathspecs } from './git-pathspec-stdin'

/** Host-side staging covers paths omitted by capped status listings: all includes untracked, tracked excludes them. */
export type GitStageWorktreeScope = 'all' | 'tracked'

/** What a host that ran a scoped stage replies with; a host without scope support replies without it. */
export type GitStageWorktreeScopeReceipt = { stagedScope: GitStageWorktreeScope }

export function parseGitStageWorktreeScope(value: unknown): GitStageWorktreeScope | undefined {
  return value === 'all' || value === 'tracked' ? value : undefined
}

export const GIT_STAGE_WORKTREE_SCOPE_UNSUPPORTED_MESSAGE =
  'The Orca version running this workspace cannot stage changes beyond the ones listed, so nothing was staged. Update Orca on that host, or stage from a terminal.'

/** Older hosts strip scope and stage the empty filePaths list; require a receipt before reporting stage-all success. */
export function requireGitStageWorktreeScopeReceipt(
  reply: unknown,
  scope: GitStageWorktreeScope
): void {
  if (
    typeof reply === 'object' &&
    reply !== null &&
    'stagedScope' in reply &&
    reply.stagedScope === scope
  ) {
    return
  }
  throw new Error(GIT_STAGE_WORKTREE_SCOPE_UNSUPPORTED_MESSAGE)
}

type GitStageRunner = (args: string[], stdin?: string) => Promise<{ stdout: string }>

export type StageGitWorktreeScopeOptions = {
  /** Untracked paths `all` must skip: Orca's shared symlinks, already verified as symlinks. */
  excludedUntrackedPaths?: readonly string[]
  /** The execution owner decides casing; a Windows viewer may be staging on POSIX or WSL. */
  caseSensitive?: boolean
}

function nulSeparatedPaths(stdout: string): string[] {
  return stdout.split('\0').filter(Boolean)
}

export async function stageGitWorktreeScope(
  scope: GitStageWorktreeScope,
  runGit: GitStageRunner,
  options: StageGitWorktreeScopeOptions = {}
): Promise<GitStageWorktreeScopeReceipt> {
  const excluded = scope === 'all' ? (options.excludedUntrackedPaths ?? []) : []
  // --relative keeps folder workspaces inside their own portion of a larger repo.
  const unresolved = nulSeparatedPaths(
    (await runGit(['diff', '--name-only', '--relative', '-z', '--diff-filter=U'])).stdout
  )
  if (unresolved.length === 0 && excluded.length === 0) {
    await runGit(['add', scope === 'all' ? '--all' : '--update', '--', '.'])
    return { stagedScope: scope }
  }
  // Name safe paths: exclude pathspecs can resolve conflicts or error on ignored Windows junctions.
  const unresolvedSet = new Set(unresolved)
  const normalize = (path: string): string => {
    const relative = path
      .replaceAll('\\', '/')
      .replace(/^(?:\.\/)+/, '')
      .replace(/\/+$/, '')
    return options.caseSensitive === false ? relative.toLowerCase() : relative
  }
  const excludedPaths = excluded.map(normalize).filter(Boolean)
  const tracked = nulSeparatedPaths(
    (await runGit(['diff', '--name-only', '--relative', '--no-renames', '-z'])).stdout
  ).filter((path) => !unresolvedSet.has(path))
  const untracked =
    scope === 'all'
      ? nulSeparatedPaths(
          (await runGit(['ls-files', '-z', '--others', '--exclude-standard'])).stdout
        ).filter((path) => {
          const relative = normalize(path)
          return !excludedPaths.some(
            (excludedPath) => relative === excludedPath || relative.startsWith(`${excludedPath}/`)
          )
        })
      : []
  const paths = [...new Set([...tracked, ...untracked])]
  if (paths.length > 0) {
    await runGit(
      ['add', '--pathspec-from-file=-', '--pathspec-file-nul'],
      encodeGitPathspecs(paths.map((path) => `:(literal)${path}`))
    )
  }
  return { stagedScope: scope }
}
