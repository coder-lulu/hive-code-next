import { z } from 'zod'
import { TaskDigest, boundedTaskCollection } from '../task-execution/task-execution-primitives'

export const TASK_CODE_SNAPSHOT_LIMITS = Object.freeze({
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  entries: 20_000,
  depth: 64
})
export const TaskCodeSnapshotPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !/[\\:\0]/.test(value) &&
      value.split('/').every((part) => part && part !== '.' && part !== '..')
  )
export const TaskCodeSnapshotFileSchema = z.strictObject({
  path: TaskCodeSnapshotPathSchema,
  size: z.number().int().min(0).max(TASK_CODE_SNAPSHOT_LIMITS.fileBytes),
  digest: TaskDigest,
  executableBits: z
    .number()
    .int()
    .min(0)
    .max(0o111)
    .refine((value) => (value & ~0o111) === 0)
})
export const TaskCodeSnapshotTreeSchema = z
  .strictObject({
    directories: boundedTaskCollection(
      TaskCodeSnapshotPathSchema,
      TASK_CODE_SNAPSHOT_LIMITS.entries
    ),
    files: boundedTaskCollection(TaskCodeSnapshotFileSchema, TASK_CODE_SNAPSHOT_LIMITS.entries)
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
