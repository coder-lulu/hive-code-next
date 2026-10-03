import { z } from 'zod'
import {
  hiveAgentBindingSchema,
  hiveAgentGenerationSchema,
  hiveAgentSessionSchema,
  hiveAgentTurnSchema
} from './hive-agent-session-schema'

/** Current execution references only; never embeds transcript, prior turns or process leases. */
export const hiveAgentSessionAggregateSchema = z
  .strictObject({
    session: hiveAgentSessionSchema,
    binding: hiveAgentBindingSchema.optional(),
    turn: hiveAgentTurnSchema.optional(),
    generation: hiveAgentGenerationSchema.optional()
  })
  .superRefine(({ session, binding, turn, generation }, context) => {
    const reject = (path: string[], message: string) =>
      context.addIssue({ code: 'custom', path, message })
    if (session.backendBindingRef !== binding?.bindingId) {
      reject(['binding'], 'Session binding reference mismatch')
    }
    if (turn && turn.sessionId !== session.sessionId) {
      reject(['turn', 'sessionId'], 'Turn belongs to another session')
    }
    if (session.activeGenerationId !== generation?.generationId) {
      reject(['generation'], 'Active generation reference mismatch')
    }
    if (generation && (!turn || generation.turnId !== turn.turnId)) {
      reject(['generation', 'turnId'], 'Generation turn reference mismatch')
    }
    if (generation && turn && generation.state !== turn.state) {
      reject(['generation', 'state'], 'Current generation and turn state mismatch')
    }
    if (generation && (!binding || generation.providerBindingRef !== binding.bindingId)) {
      reject(['generation', 'providerBindingRef'], 'Generation binding reference mismatch')
    }
    if (generation && binding && generation.capabilityRevision !== binding.capabilityRevision) {
      reject(['generation', 'capabilityRevision'], 'Generation capability revision mismatch')
    }
    if (
      generation?.executionBinding &&
      generation.executionBinding.profileId !== session.profileId
    ) {
      reject(['generation', 'executionBinding', 'profileId'], 'Generation profile mismatch')
    }
    if (turn && turn.createdAt < session.createdAt) {
      reject(['turn', 'createdAt'], 'Turn predates session')
    }
  })

export type HiveAgentSessionAggregate = z.infer<typeof hiveAgentSessionAggregateSchema>
