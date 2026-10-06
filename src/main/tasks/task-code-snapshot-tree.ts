import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import {
  TaskDigest,
  boundedTaskCollection
} from '../../shared/task-execution/task-execution-primitives'
import { readTaskArtifactFile } from './task-artifact-index'
import { taskLaunchPathKey } from './task-launch-workspace'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

export const TASK_CODE_SNAPSHOT_LIMITS = Object.freeze({
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  entries: 20_000,
  depth: 64
})
const Path = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !/[\\:\0]/.test(value) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..')
  )
export const TaskCodeSnapshotTreeSchema = z
  .strictObject({
    directories: boundedTaskCollection(Path, TASK_CODE_SNAPSHOT_LIMITS.entries),
    files: boundedTaskCollection(
      z.strictObject({
        path: Path,
        size: z.number().int().min(0).max(TASK_CODE_SNAPSHOT_LIMITS.fileBytes),
        digest: TaskDigest,
        executableBits: z
          .number()
          .int()
          .min(0)
          .max(0o111)
          .refine((value) => (value & ~0o111) === 0)
      }),
      TASK_CODE_SNAPSHOT_LIMITS.entries
    )
  })
  .superRefine((tree, context) => {
    const paths = [...tree.directories, ...tree.files.map((file) => file.path)]
    const directories = new Set(tree.directories)
    const invalid =
      paths.length > TASK_CODE_SNAPSHOT_LIMITS.entries ||
      new Set(paths).size !== paths.length ||
      tree.files.reduce((total, file) => total + file.size, 0) >
        TASK_CODE_SNAPSHOT_LIMITS.totalBytes ||
      tree.directories.some((path) => path.split('/').length > TASK_CODE_SNAPSHOT_LIMITS.depth) ||
      paths.some((path) =>
        path
          .split('/')
          .slice(0, -1)
          .some((_, index, parts) => !directories.has(parts.slice(0, index + 1).join('/')))
      ) ||
      tree.files.some((file) => file.path.split('/').length > TASK_CODE_SNAPSHOT_LIMITS.depth + 1)
    if (invalid) {
      context.addIssue({ code: 'custom', message: 'Invalid bounded complete code tree.' })
    }
  })
export type TaskCodeSnapshotTree = z.infer<typeof TaskCodeSnapshotTreeSchema>
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
