import { z } from 'zod'
import { TaskCounter, TaskDigest, TaskOpaqueRef } from '../task-execution/task-execution-primitives'
import { parseAgentJournalItemKey } from '../agent-session-journal-item-key'
import { WorkflowNativeProducerSchema } from './workflow-native-producer'

export const WORKFLOW_COMMAND_EVIDENCE_MAX_COMMANDS = 128
export const WORKFLOW_COMMAND_EVIDENCE_INLINE_BYTES = 16 * 1024
const counter = TaskCounter
const sequence = counter.min(1)
const journalKey = z
  .string()
  .min(1)
  .max(16 * 1024)
  .refine((value) => parseAgentJournalItemKey(value) !== null)
const inlineText = z
  .string()
  .max(WORKFLOW_COMMAND_EVIDENCE_INLINE_BYTES)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= WORKFLOW_COMMAND_EVIDENCE_INLINE_BYTES,
    'workflow_command_evidence_inline_limit'
  )
export const WorkflowCommandOutputSchema = z
  .strictObject({
    head: inlineText,
    byteLength: counter,
    digest: TaskDigest,
    truncated: z.boolean()
  })
  .superRefine((output, context) => {
    const bytes = new TextEncoder().encode(output.head).byteLength
    if (output.byteLength < bytes || (!output.truncated && output.byteLength !== bytes)) {
      context.addIssue({ code: 'custom', message: 'workflow_command_output_length_mismatch' })
    }
  })
export const WorkflowCommandFactSchema = z
  .strictObject({
    itemId: journalKey,
    revision: counter,
    callId: TaskOpaqueRef,
    sequence,
    command: inlineText.refine((value) => value.length > 0 && !value.includes('\0')),
    cwd: inlineText.refine((value) => value.length > 0 && !value.includes('\0')),
    state: z.enum(['completed', 'failed']),
    exitCode: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    durationMs: z.number().finite().min(0).optional(),
    output: WorkflowCommandOutputSchema.optional()
  })
  .superRefine((command, context) => {
    if (
      (command.state === 'completed' && command.exitCode !== 0) ||
      new TextEncoder().encode(JSON.stringify({ command: command.command, cwd: command.cwd }))
        .byteLength > WORKFLOW_COMMAND_EVIDENCE_INLINE_BYTES
    ) {
      context.addIssue({ code: 'custom', message: 'workflow_command_metadata_mismatch' })
    }
  })
export const WorkflowCommandEvidenceUnavailableReasonSchema = z.enum([
  'record_not_stopped',
  'journal_unavailable',
  'journal_binding_unavailable',
  'command_metadata_unavailable',
  'command_limit_exceeded'
])
export const WorkflowCommandEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('available'),
      producer: WorkflowNativeProducerSchema,
      sessionId: TaskOpaqueRef,
      journalCursor: z.strictObject({ epoch: TaskOpaqueRef, sequence: counter }),
      turnItemId: journalKey,
      turnRevision: counter,
      turnSequence: sequence,
      providerTurnId: TaskOpaqueRef,
      turnOutcome: z.enum(['success', 'failure']),
      commands: z.array(WorkflowCommandFactSchema).max(WORKFLOW_COMMAND_EVIDENCE_MAX_COMMANDS)
    })
    .superRefine((facts, context) => {
      if (
        facts.producer.sessionRef !== facts.sessionId ||
        facts.turnSequence > facts.journalCursor.sequence ||
        facts.commands.some((command) => command.sequence > facts.journalCursor.sequence) ||
        new Set(facts.commands.map((command) => command.itemId)).size !== facts.commands.length ||
        new Set(facts.commands.map((command) => command.callId)).size !== facts.commands.length
      ) {
        context.addIssue({ code: 'custom', message: 'workflow_command_evidence_binding_mismatch' })
      }
    }),
  z.strictObject({
    kind: z.literal('unavailable'),
    reason: WorkflowCommandEvidenceUnavailableReasonSchema
  })
])
export type WorkflowCommandEvidence = z.infer<typeof WorkflowCommandEvidenceSchema>
export type WorkflowCommandFact = z.infer<typeof WorkflowCommandFactSchema>
export type WorkflowCommandEvidenceUnavailableReason = z.infer<
  typeof WorkflowCommandEvidenceUnavailableReasonSchema
>
