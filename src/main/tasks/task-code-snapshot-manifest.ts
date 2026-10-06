import { z } from 'zod'
import { WorkflowCodeVersionSchema } from '../../shared/task-workflow/workflow-evidence'
import { TaskCodeSnapshotProducerSchema } from './task-code-snapshot-producer'
import { TaskCodeSnapshotTreeSchema } from './task-code-snapshot-tree'

export const TaskCodeSnapshotManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  producer: TaskCodeSnapshotProducerSchema,
  omissions: z.strictObject({
    directories: z.tuple([z.literal('.git'), z.literal('node_modules'), z.literal('logs')]),
    runtimeManifest: z.string().min(1).max(160)
  }),
  tree: TaskCodeSnapshotTreeSchema
})
export const TaskCodeSnapshotVersionSchema = WorkflowCodeVersionSchema.options[1].extend({
  snapshot: WorkflowCodeVersionSchema.options[1].shape.snapshot.extend({
    artifactRevision: z.literal(1)
  })
})
export type TaskCodeSnapshotVersion = z.infer<typeof TaskCodeSnapshotVersionSchema>
