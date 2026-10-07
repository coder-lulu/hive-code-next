import { z } from 'zod'
import { canonicalAgentSessionDigest as digest } from '../agent-session-mutation-envelope'
import { WorkflowNativeOutcomeAssetSchema } from './workflow-native-outcome'
import { WorkflowNativeArtifactSchema } from './workflow-native-artifact'
import { WorkflowCommandEvidenceSchema } from './workflow-command-evidence'

// Private dispatcher data; the original authenticated run and settlement transaction grant authority.
export const WorkflowNativeDeliverySchema = z
  .strictObject({
    kind: z.literal('workflow.native-delivery'),
    asset: WorkflowNativeOutcomeAssetSchema,
    artifacts: z.array(WorkflowNativeArtifactSchema).max(2),
    commands: WorkflowCommandEvidenceSchema.optional()
  })
  .superRefine((delivery, issue) => {
    const outcome = delivery.asset.outcome
    if (
      new Set(delivery.artifacts.map((artifact) => artifact.version.artifactRef)).size !==
        delivery.artifacts.length ||
      delivery.artifacts.some(
        (artifact) =>
          !outcome.artifacts.some(
            (member) =>
              member.name === artifact.name && digest(member.version) === digest(artifact.version)
          )
      )
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_native_delivery_artifact_mismatch' })
    }
    const facts = delivery.commands
    if (
      facts &&
      (outcome.commands.kind !== facts.kind ||
        (facts.kind === 'available' && digest(facts.producer) !== digest(outcome.producer)) ||
        (facts.kind === 'unavailable' &&
          outcome.commands.kind === 'unavailable' &&
          facts.reason !== outcome.commands.reason))
    ) {
      issue.addIssue({ code: 'custom', message: 'workflow_native_delivery_commands_mismatch' })
    }
  })

export type WorkflowNativeDelivery = z.infer<typeof WorkflowNativeDeliverySchema>
