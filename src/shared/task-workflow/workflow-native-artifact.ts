import { z } from 'zod'
import { WorkflowNativeOutcomeAssetSchema } from './workflow-native-outcome'

export const WORKFLOW_NATIVE_ARTIFACT_MAX_BYTES = 1024 * 1024
export const WorkflowNativeArtifactSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(512)
    .refine((value) => value.isWellFormed()),
  version: WorkflowNativeOutcomeAssetSchema.shape.version,
  text: z
    .string()
    .max(WORKFLOW_NATIVE_ARTIFACT_MAX_BYTES)
    .refine(
      (value) =>
        value.isWellFormed() &&
        new TextEncoder().encode(value).byteLength <= WORKFLOW_NATIVE_ARTIFACT_MAX_BYTES
    )
})
export type WorkflowNativeArtifact = z.infer<typeof WorkflowNativeArtifactSchema>
