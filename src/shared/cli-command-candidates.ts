import { lstatSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { getCliInstallDirectories, getExecutableNames } from './node-cli-command-resolution'

/** Inventory shares CLI resolution's directory and launcher order, retaining broken executables. */
export function listCliCommandCandidates(
  commandName: string,
  options: { pathEnv?: string; platform?: NodeJS.Platform; homePath?: string } = {}
): string[] {
  const platform = options.platform ?? process.platform
  const hostPath = platform === 'win32' ? path.win32 : path.posix
  const directories = new Set([
    ...(options.pathEnv ?? process.env.PATH ?? process.env.Path ?? '').split(hostPath.delimiter),
    ...getCliInstallDirectories(platform, options.homePath ?? homedir())
  ])
  const candidates: string[] = []
  for (const raw of [...directories].slice(0, 256)) {
    const directory = raw.trim()
    if (!hostPath.isAbsolute(directory)) {
      continue
    }
    let hasWindowsLauncher = false
    for (const name of getExecutableNames(platform, commandName)) {
      const candidate = hostPath.join(directory, name)
      try {
        const stats = lstatSync(candidate)
        if (stats.isFile() || stats.isSymbolicLink()) {
          // npm ships a POSIX companion beside its Windows launcher, not a second installation.
          if (
            platform === 'win32' &&
            name === commandName &&
            hasWindowsLauncher &&
            stats.isFile() &&
            stats.size <= 64 * 1024 &&
            /^#![^\r\n]*\b(?:sh|bash)(?:\s|$)/.test(readFileSync(candidate, 'utf8'))
          ) {
            continue
          }
          candidates.push(candidate)
          if (name !== commandName) {
            hasWindowsLauncher = true
          }
        }
      } catch {
        // A stale PATH entry is not an installed CLI.
      }
    }
  }
  return candidates
}
