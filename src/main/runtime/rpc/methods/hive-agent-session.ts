import { z } from 'zod'
import { defineMethod, defineStreamingMethod, type RpcAnyMethod, type RpcContext } from '../core'
import {
  HIVE_AGENT_METHODS,
  type AuthenticatedRuntimePrincipal
} from '../../../../shared/hive-agent-session-methods'
import type { HiveAgentSessionHost } from '../../../native-chat/hive-agent-session-host'

/** Installed on the existing local dispatcher by its host, not the global remote registry. */
export function hiveAgentSessionMethods(
  host: HiveAgentSessionHost,
  authenticate: (context: RpcContext) => AuthenticatedRuntimePrincipal | null
): RpcAnyMethod[] {
  return Object.keys(HIVE_AGENT_METHODS).map((name) =>
    name === 'hiveAgent.subscribe'
      ? defineStreamingMethod({
          name,
          params: z.unknown(),
          handler: async (params, context, emit) => {
            if (!context.signal || context.signal.aborted) {
              return
            }
            let close: (() => void) | undefined
            try {
              close = await host.subscribe(params, () => authenticate(context), emit)
              await new Promise<void>((resolve) => {
                if (context.signal!.aborted) {
                  resolve()
                } else {
                  context.signal!.addEventListener('abort', () => resolve(), { once: true })
                }
              })
            } catch {
              emit({ ok: false, error: { code: 'hive_agent_forbidden' } })
            } finally {
              close?.()
            }
          }
        })
      : defineMethod({
          name,
          params: z.unknown(),
          handler: (params, context) => host.call(name, params, () => authenticate(context))
        })
  )
}
