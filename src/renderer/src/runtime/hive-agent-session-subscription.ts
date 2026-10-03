import type { z } from 'zod'
import type { RuntimeApi } from '../../../preload/api/runtime-api'
import { hiveAgentMethodSchemas } from '../../../shared/hive-agent-session-methods'
import { hiveAgentSessionErrorSchema } from '../../../shared/hive-agent-session-schema'
import { hiveAgentHistoryEventSchema, type HiveAgentHistoryEvent } from './hive-agent-history-wire'
import { unwrapRuntimeRpcResult } from './runtime-rpc-result'

type CloseReason = 'disconnected' | z.output<typeof hiveAgentSessionErrorSchema>['code']

/** Returns a disposer immediately, including while preload is still opening its handle. */
export function subscribeHiveAgentSession(options: {
  projectSelector: string
  params: z.input<(typeof hiveAgentMethodSchemas)['hiveAgent.subscribe']>
  signal: AbortSignal
  subscribe: RuntimeApi['runtime']['subscribe']
  onEvent: (event: Exclude<HiveAgentHistoryEvent, { type: 'end' }>) => void
  onClose: (reason: CloseReason) => void
}): () => void {
  const { signal, onEvent, onClose } = options
  let closed = false
  let release: (() => void) | undefined
  const dispose = () => {
    if (closed) {
      return
    }
    closed = true
    signal.removeEventListener('abort', dispose)
    const close = release
    release = undefined
    close?.()
  }
  const finish = (reason: CloseReason) => {
    if (closed) {
      return
    }
    dispose()
    onClose(reason)
  }
  if (signal.aborted) {
    dispose()
    return dispose
  }
  const input = hiveAgentMethodSchemas['hiveAgent.subscribe'].safeParse(options.params)
  if (!input.success || !options.projectSelector || options.projectSelector.length > 512) {
    finish('hive_agent_invalid_request')
    return dispose
  }
  signal.addEventListener('abort', dispose, { once: true })
  const schema = hiveAgentHistoryEventSchema(input.data.sessionId)
  void (async () => {
    try {
      const handle = await options.subscribe(
        {
          method: 'hiveAgent.subscribe',
          params: { projectSelector: options.projectSelector, params: input.data }
        },
        (response) => {
          if (closed || signal.aborted) {
            return
          }
          try {
            const raw = unwrapRuntimeRpcResult(response)
            const failure =
              typeof raw === 'object' &&
              raw !== null &&
              'ok' in raw &&
              raw.ok === false &&
              'error' in raw
                ? hiveAgentSessionErrorSchema.safeParse(raw.error)
                : null
            if (failure?.success) {
              finish(failure.data.code)
              return
            }
            const event = schema.safeParse(raw)
            if (!event.success) {
              finish('hive_agent_outcome_unknown')
            } else if (event.data.type === 'end') {
              finish('disconnected')
            } else {
              onEvent(event.data)
            }
          } catch {
            finish('hive_agent_outcome_unknown')
          }
        }
      )
      if (closed) {
        handle.unsubscribe()
      } else {
        release = () => handle.unsubscribe()
      }
    } catch {
      finish('hive_agent_outcome_unknown')
    }
  })()
  return dispose
}
