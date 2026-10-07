import { z } from 'zod'
import { WORKFLOW_CONTRACT_VERSION } from './workflow-bindings'
import { WorkflowExecutionContextSchema } from './workflow-execution-context'
import { WorkflowNativeProducerSchema } from './workflow-native-producer'
import { WorkflowArtifactVersionSchema, WorkflowCodeVersionSchema } from './workflow-evidence'
import { WorkflowCommandEvidenceUnavailableReasonSchema } from './workflow-command-evidence'

export const WORKFLOW_NATIVE_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024
const assetVersion = WorkflowArtifactVersionSchema.extend({
  artifactRef: z
    .string()
    .length(73)
    .regex(/^artifact:[a-f0-9]{64}$/),
  artifactRevision: z.literal(1)
})
export const WorkflowNativeOutcomeSchema = z
  .strictObject({
    contractVersion: z.literal(WORKFLOW_CONTRACT_VERSION),
    kind: z.literal('workflow.native-outcome'),
    context: WorkflowExecutionContextSchema,
    producer: WorkflowNativeProducerSchema,
    artifacts: z
      .array(z.strictObject({ name: z.string().min(1).max(512), version: assetVersion }))
      .max(32),
    codeVersion: WorkflowCodeVersionSchema.optional(),
    commands: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('available'), artifact: assetVersion }),
      z.strictObject({
        kind: z.literal('unavailable'),
        reason: WorkflowCommandEvidenceUnavailableReasonSchema
      })
    ])
  })
  .superRefine((outcome, issue) => {
    if (
      outcome.context.binding.scope.companyRef !== outcome.producer.task.spaceId ||
      !outcome.producer.sessionRef ||
      new Set(outcome.artifacts.map((item) => item.version.artifactRef)).size !==
        outcome.artifacts.length ||
      (outcome.context.role === 'developer' && outcome.codeVersion?.kind !== 'snapshot') ||
      (outcome.context.role === 'tester' &&
        JSON.stringify(outcome.codeVersion) !== JSON.stringify(outcome.context.codeInput?.version))
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_native_outcome_binding_mismatch' })
    }
  })
export const WorkflowNativeOutcomeAssetSchema = z.strictObject({
  outcome: WorkflowNativeOutcomeSchema,
  version: assetVersion
})
export type WorkflowNativeOutcome = z.infer<typeof WorkflowNativeOutcomeSchema>
export type WorkflowNativeOutcomeAsset = z.infer<typeof WorkflowNativeOutcomeAssetSchema>
