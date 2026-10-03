import { z } from 'zod'
import type { RuntimeApi } from '../../../preload/api/runtime-api'
import {
  hiveAgentMethodSchemas,
  hiveAgentSessionListSchema,
  type HiveAgentMethod
} from '../../../shared/hive-agent-session-methods'
import { hiveAgentSessionAggregateSchema } from '../../../shared/hive-agent-session-aggregate'
import {
  HIVE_AGENT_SESSION_ERROR_CODES,
  hiveAgentSessionErrorSchema,
  hiveAgentSessionIdSchema
} from '../../../shared/hive-agent-session-schema'
import { unwrapRuntimeRpcResult } from './runtime-rpc-result'
import { hiveAgentHistoryResultSchema } from './hive-agent-history-wire'
import { hiveAiTextControlReplySchema } from '../../../shared/hive-ai-text-control'

type Mutation = 'hiveAgent.create' | 'hiveAgent.submit' | 'hiveAgent.cancel' | 'hiveAgent.delete'
const receipt = z.strictObject({
  sessionId: hiveAgentSessionIdSchema,
  operationId: hiveAgentMethodSchemas['hiveAgent.create'].shape.operationId,
  status: z.enum(['pending', 'succeeded', 'failed', 'unknown']),
  replayed: z.boolean()
})
const aggregate = hiveAgentSessionAggregateSchema.refine(
  (value) => !value.binding || !Object.hasOwn(value.binding, 'encryptedSecretRef')
)

/** Uses desktop IPC only. The caller owns operation IDs and invalidates this view on identity changes. */
export function createHiveAgentSessionClient(options: {
  projectSelector: string
  signal: AbortSignal
  call: RuntimeApi['runtime']['call']
}) {
  const { projectSelector, signal, call } = options
  const current = () => {
    if (signal.aborted) {
      throw new Error('hive_agent_forbidden')
    }
  }
  async function request<T>(
    method: HiveAgentMethod,
    raw: unknown,
    schema: z.ZodType<T>
  ): Promise<T> {
    try {
      current()
      const input = hiveAgentMethodSchemas[method].safeParse(raw)
      if (!input.success || !projectSelector || projectSelector.length > 512) {
        throw new Error('hive_agent_invalid_request')
      }
      const response = await call({ method, params: { projectSelector, params: input.data } })
      current()
      const result = z
        .discriminatedUnion('ok', [
          z.strictObject({ ok: z.literal(true), value: schema }),
          z.strictObject({ ok: z.literal(false), error: hiveAgentSessionErrorSchema })
        ])
        .safeParse(unwrapRuntimeRpcResult(response))
      if (!result.success) {
        throw new Error('hive_agent_outcome_unknown')
      }
      if (!result.data.ok) {
        throw new Error(result.data.error.code)
      }
      return result.data.value
    } catch (error) {
      current()
      const code =
        error instanceof Error &&
        HIVE_AGENT_SESSION_ERROR_CODES.some((value) => value === error.message)
          ? error.message
          : 'hive_agent_outcome_unknown'
      throw new Error(code)
    }
  }
  return {
    execution: (sessionId: string, generationId: string) =>
      request(
        'hiveAgent.execution',
        { sessionId, generationId },
        hiveAiTextControlReplySchema.refine(
          (value) =>
            value.generationId === generationId &&
            value.requestId === generationId.slice('ha-generation:'.length)
        )
      ),
    history: (params: z.input<(typeof hiveAgentMethodSchemas)['hiveAgent.history']>) =>
      request('hiveAgent.history', params, hiveAgentHistoryResultSchema(params.sessionId)),
    exportPage: (params: z.input<(typeof hiveAgentMethodSchemas)['hiveAgent.export']>) =>
      request('hiveAgent.export', params, hiveAgentHistoryResultSchema(params.sessionId)),
    list: (params: z.input<(typeof hiveAgentMethodSchemas)['hiveAgent.list']> = {}) =>
      request('hiveAgent.list', params, hiveAgentSessionListSchema),
    read: (sessionId: string) =>
      request(
        'hiveAgent.read',
        { sessionId },
        aggregate.refine((value) => value.session.sessionId === sessionId)
      ),
    mutate: <T extends Mutation>(method: T, params: z.input<(typeof hiveAgentMethodSchemas)[T]>) =>
      request(
        method,
        params,
        receipt.refine(
          (value) =>
            value.sessionId === params.sessionId && value.operationId === params.operationId
        )
      )
  }
}
