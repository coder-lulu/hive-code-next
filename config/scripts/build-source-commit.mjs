import { execFileSync } from 'node:child_process'

/** Resolve the exact source revision embedded in this HiveCode build. */
export function resolveBuildSourceCommit() {
  let commit = ''
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
  } catch (error) {
    throw new Error(
      `Could not read the source commit with \`git rev-parse HEAD\`: ${
        error instanceof Error ? error.message : String(error)
      }. HiveCode builds must run from a Git checkout to record their source revision.`
    )
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`\`git rev-parse HEAD\` returned "${commit}", not a full commit hash.`)
  }
  return commit
}
