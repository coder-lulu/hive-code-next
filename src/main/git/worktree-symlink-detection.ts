import { lstat, readdir } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { resolveWorktreeHostPath } from '../../shared/git-metadata-path'

// Keep read-only symlink detection independent of APFS materialization and child-process imports.

export type SafeRelativePathResult = { safe: true; rel: string } | { safe: false }

// isAbsolute misses drive-relative C:foo, which still escapes the worktree on Windows.
const WINDOWS_DRIVE_DESIGNATOR = /^[a-zA-Z]:/

export function getSafeRelativePath(rawPath: string): SafeRelativePathResult {
  // Strip either separator style before validating so host syntax cannot change the verdict.
  const rel = rawPath.trim().replace(/^[\\/]+/, '')
  // Validate both separator styles and drive prefixes after ./ normalization on every host.
  const segments = rel.split(/[\\/]/).filter((segment) => segment !== '' && segment !== '.')
  if (
    segments.length === 0 ||
    WINDOWS_DRIVE_DESIGNATOR.test(segments[0]) ||
    segments.includes('..')
  ) {
    return { safe: false }
  }
  // Match Git's normalized spelling, using only separators the host filesystem resolves.
  const gitRel =
    sep === '\\'
      ? segments.join('/')
      : rel
          .split('/')
          .filter((segment) => segment !== '' && segment !== '.')
          .join('/')
  return gitRel ? { safe: true, rel: gitRel } : { safe: false }
}

export type WorktreeSymlinkDetectionOptions = {
  /** Distro that spelled `worktreePath`, for a Windows host reopening a guest path. */
  wslDistro?: string
}

async function canonicalRelativePath(root: string, relativePath: string): Promise<string> {
  let directory = root
  const segments: string[] = []
  for (const segment of relativePath.split('/')) {
    const names = await readdir(directory)
    let canonical = names.includes(segment) ? segment : undefined
    if (canonical === undefined) {
      const identity = await lstat(resolve(directory, segment), { bigint: true })
      for (const candidate of names) {
        if (candidate.toLowerCase() !== segment.toLowerCase()) {
          continue
        }
        const observed = await lstat(resolve(directory, candidate), { bigint: true })
        if (
          identity.ino > 0n &&
          observed.ino > 0n &&
          observed.dev === identity.dev &&
          observed.ino === identity.ino
        ) {
          canonical = candidate
          break
        }
      }
    }
    if (canonical === undefined) {
      throw new Error('Cannot identify the verified shared link in its directory')
    }
    segments.push(canonical)
    directory = resolve(directory, canonical)
  }
  return segments.join('/')
}

export async function findExistingWorktreeSymlinkPaths(
  worktreePath: string,
  paths: readonly string[],
  options: WorktreeSymlinkDetectionOptions = {}
): Promise<string[]> {
  // Node filesystem reads need host spelling even when WSL Git reported guest paths.
  const hostWorktreePath = resolveWorktreeHostPath(worktreePath, options) ?? worktreePath
  const symlinkPaths: string[] = []
  for (const rawPath of paths) {
    const safePath = getSafeRelativePath(rawPath)
    if (!safePath.safe) {
      continue
    }
    let isSymlink = false
    try {
      isSymlink = (await lstat(resolve(hostWorktreePath, safePath.rel))).isSymbolicLink()
    } catch {
      // Why: only a positively identified symlink may bypass dirty preflight.
    }
    if (isSymlink) {
      // Match Git's spelling only after disk identity proves a case alias. WSL/POSIX names
      // remain distinct; failed canonicalization refuses staging instead of omitting a link.
      symlinkPaths.push(await canonicalRelativePath(hostWorktreePath, safePath.rel))
    }
  }
  return symlinkPaths
}
