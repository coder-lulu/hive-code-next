import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import {
  TASK_CODE_SNAPSHOT_LIMITS,
  TaskCodeSnapshotPathSchema as Path,
  TaskCodeSnapshotTreeSchema,
  type TaskCodeSnapshotTree
} from '../../shared/task-workflow/workflow-code-snapshot-tree'
export { TASK_CODE_SNAPSHOT_LIMITS, TaskCodeSnapshotTreeSchema }
export type { TaskCodeSnapshotTree }
import { readTaskArtifactFile } from './task-artifact-index'
import { taskLaunchPathKey } from './task-launch-workspace'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

export type TaskCodeSnapshotOmissions = { directories: readonly string[]; runtimeManifest: string }
export const taskCodeBytesDigest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
export const taskCodeTreeDigest = (tree: TaskCodeSnapshotTree) => canonicalAgentSessionDigest(tree)
const sortPaths = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
const signature = (path: string) => {
  const stat = lstatSync(path, { bigint: true })
  if (stat.isSymbolicLink()) {
    refuseTaskExecution('FORBIDDEN')
  }
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode, stat.nlink].join(
    ':'
  )
}

/** Internal file walk: every supported source entry is checked, including entries absent from model manifests. */
export async function readTaskCodeTree(
  root: string,
  assertCurrent: () => void,
  omissions?: TaskCodeSnapshotOmissions
) {
  const tree: TaskCodeSnapshotTree = { directories: [], files: [] }
  const identities = new Map<string, string>()
  let count = 0,
    bytes = 0
  const check = () => assertTaskAuthorizationCurrent(assertCurrent)
  const visit = async (path: string, prefix: string, depth: number): Promise<void> => {
    check()
    if (depth > TASK_CODE_SNAPSHOT_LIMITS.depth) {
      refuseTaskExecution('CAPACITY_EXCEEDED')
    }
    const before = signature(path)
    if (
      !(await lstat(path)).isDirectory() ||
      taskLaunchPathKey(await realpath(path)) !== taskLaunchPathKey(path)
    ) {
      refuseTaskExecution('FORBIDDEN')
    }
    identities.set(path, before)
    const directory = await opendir(path)
    for await (const entry of directory) {
      check()
      if (++count > TASK_CODE_SNAPSHOT_LIMITS.entries) {
        refuseTaskExecution('CAPACITY_EXCEEDED')
      }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const filePath = join(path, entry.name)
      const stat = await lstat(filePath)
      if (stat.isSymbolicLink()) {
        refuseTaskExecution('FORBIDDEN')
      }
      if (
        omissions &&
        ((omissions.directories.includes(entry.name) &&
          (stat.isDirectory() || entry.name === '.git')) ||
          relative === omissions.runtimeManifest)
      ) {
        continue
      }
      if (!Path.safeParse(relative).success) {
        refuseTaskExecution('FORBIDDEN')
      }
      if (stat.isDirectory()) {
        tree.directories.push(relative)
        await visit(filePath, relative, depth + 1)
      } else if (stat.isFile() && stat.nlink === 1) {
        if (
          stat.size > TASK_CODE_SNAPSHOT_LIMITS.fileBytes ||
          bytes + stat.size > TASK_CODE_SNAPSHOT_LIMITS.totalBytes
        ) {
          refuseTaskExecution('CAPACITY_EXCEEDED')
        }
        const identity = signature(filePath)
        const data = await readTaskArtifactFile(root, relative, TASK_CODE_SNAPSHOT_LIMITS.fileBytes)
        if (signature(filePath) !== identity) {
          refuseTaskExecution('REVISION_CONFLICT')
        }
        identities.set(filePath, identity)
        bytes += data.byteLength
        tree.files.push({
          path: relative,
          size: data.byteLength,
          digest: taskCodeBytesDigest(data),
          executableBits: stat.mode & 0o111
        })
      } else {
        refuseTaskExecution('FORBIDDEN')
      }
    }
    check()
    if (signature(path) !== before) {
      refuseTaskExecution('REVISION_CONFLICT')
    }
  }
  await visit(root, '', 0)
  tree.directories.sort(sortPaths)
  tree.files.sort((left, right) => sortPaths(left.path, right.path))
  const parsed = TaskCodeSnapshotTreeSchema.safeParse(tree)
  if (!parsed.success) {
    refuseTaskExecution('CAPACITY_EXCEEDED')
  }
  const assertUnchanged = () => {
    check()
    for (const [path, identity] of identities) {
      if (signature(path) !== identity) {
        refuseTaskExecution('REVISION_CONFLICT')
      }
    }
  }
  assertUnchanged()
  return { tree: parsed.data, assertUnchanged }
}
