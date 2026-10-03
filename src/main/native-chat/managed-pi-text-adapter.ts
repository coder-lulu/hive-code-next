import { parseHiveAgentTextContext } from '../../shared/hive-agent-text-context'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { isAgentSessionId } from '../../shared/agent-session-record'
import { hiveAiModelSelectionCommandSchema } from '../../shared/hive-ai-model-catalog'
import { hiveAiTextMessageSchema } from '../../shared/hive-ai-text-request'
import { hiveAgentTextExecutionBindingSchema } from '../../shared/hive-agent-text-pack'
import {
  hiveAgentBindingSchema,
  hiveAgentSessionIdSchema,
  hiveAgentGenerationIdSchema
} from '../../shared/hive-agent-session-schema'
import {
  verifyManagedPiRuntimeIdentity,
  type VerifiedManagedPiPack
} from '../runtime/managed-pi-runtime-identity'
import { resolveHiveAgentTextPack } from './hive-agent-text-pack'
import type { HiveAgentTextAdapter, HiveAgentTextEvent } from './hive-agent-text-adapter'

type RunInput = Parameters<HiveAgentTextAdapter['run']>[0]
const inputSchema = z.strictObject({
  sessionId: hiveAgentSessionIdSchema,
  generationId: hiveAgentGenerationIdSchema,
  text: hiveAiTextMessageSchema.shape.text,
  history: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        text: hiveAiTextMessageSchema.shape.text
      })
    )
    .max(62),
  modelSelection: hiveAiModelSelectionCommandSchema,
  executionBinding: hiveAgentTextExecutionBindingSchema,
  signal: z.instanceof(AbortSignal)
})
/** Execution-host supervisor port; it must use these verified launch files and await shutdown. */
export type ManagedPiTextDriver = {
  run(
    input: Readonly<RunInput & { launchFiles: Readonly<{ node: string; runner: string }> }>
  ): AsyncIterable<unknown>
}
const eventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    sequence: z.number().int().min(1).max(999),
    text: z
      .string()
      .min(1)
      .max(1024 * 1024)
  }),
  z.strictObject({ type: z.literal('completed'), sequence: z.number().int().min(1).max(1000) })
])

/** No journal, retries or inference authorization; production assembly requires the supervisor. */
export async function createManagedPiTextAdapter(deps: {
  pack: VerifiedManagedPiPack
  driver: ManagedPiTextDriver
  runtimeRecordId: string
}): Promise<HiveAgentTextAdapter> {
  const { pack, driver, runtimeRecordId } = deps
  if (!isAgentSessionId(runtimeRecordId) || typeof driver?.run !== 'function') {
    throw new Error('hive_agent_capability_unavailable')
  }
  const runtime = await verifyManagedPiRuntimeIdentity(pack)
  return {
    binding(sessionId) {
      runtime.assertCurrent()
      return hiveAgentBindingSchema.parse({
        schemaVersion: 1,
        bindingId: `ha-binding:${randomUUID()}`,
        providerKind: 'managed-pi',
        providerSessionRef: hiveAgentSessionIdSchema.parse(sessionId),
        runtimeRecordRef: runtimeRecordId,
        capabilityRevision: 1,
        capabilities: ['local.text']
      })
    },
    async *run(raw): AsyncIterable<HiveAgentTextEvent> {
      const parsed = inputSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error('hive_agent_invalid_request')
      }
      const input = Object.freeze({
        ...parsed.data,
        history: parseHiveAgentTextContext(parsed.data.history, parsed.data.text),
        modelSelection: Object.freeze(parsed.data.modelSelection),
        executionBinding: Object.freeze(parsed.data.executionBinding)
      })
      const admission = resolveHiveAgentTextPack(
        pack.readPack.bind(pack),
        input.executionBinding.profileId,
        input.modelSelection.protocol
      )
      if (JSON.stringify(admission.binding) !== JSON.stringify(input.executionBinding)) {
        throw new Error('hive_agent_pack_unavailable')
      }
      const assertCurrent = () => {
        runtime.assertCurrent()
        admission.assertCurrent()
      }
      let sequence = 0
      let outputBytes = 0
      let terminal: HiveAgentTextEvent | undefined
      try {
        assertCurrent()
        if (input.signal.aborted) {
          return
        }
        const launch = Object.freeze({ ...input, launchFiles: pack.getLaunchFiles() })
        for await (const rawEvent of driver.run(launch)) {
          assertCurrent()
          if (input.signal.aborted) {
            return
          }
          const event = eventSchema.parse(rawEvent)
          if (terminal || event.sequence !== ++sequence) {
            throw new Error('invalid event order')
          }
          if (event.type === 'text') {
            outputBytes += Buffer.byteLength(event.text)
            if (!event.text.isWellFormed() || outputBytes > 1024 * 1024) {
              throw new Error('invalid output')
            }
            yield Object.freeze(event)
          } else {
            terminal = Object.freeze(event)
          }
        }
        assertCurrent()
        if (input.signal.aborted) {
          return
        }
        if (!terminal) {
          throw new Error('missing final evidence')
        }
        yield terminal
      } catch {
        throw new Error('hive_agent_outcome_unknown')
      }
    }
  }
}
