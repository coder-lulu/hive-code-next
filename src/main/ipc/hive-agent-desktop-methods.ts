import { z } from 'zod'
import { defineMethod, defineStreamingMethod, type RpcAnyMethod } from '../runtime/rpc/core'
import {
  HIVE_AGENT_METHODS,
  hiveAgentMethodSchemas,
  type HiveAgentMethod
} from '../../shared/hive-agent-session-methods'
import type { HiveAgentLocalRuntime } from '../native-chat/hive-agent-local-runtime'

/** Registered only in desktop IPC, never the network Runtime method registry. */
export function hiveAgentDesktopMethods(options: {
  getRuntime: () => HiveAgentLocalRuntime | null
  assertSender: () => void
}): RpcAnyMethod[] {
  const failure = () => ({ ok: false, error: { code: 'hive_agent_forbidden' } })
  const open = async (method: HiveAgentMethod, raw: unknown, signal?: AbortSignal) => {
    options.assertSender()
    if (signal?.aborted) {
      throw new Error('hive_agent_forbidden')
    }
    const input = z
      .strictObject({
        projectSelector: z.string().min(1).max(512),
        params: hiveAgentMethodSchemas[method]
      })
      .parse(raw)
    if (JSON.stringify(input).length > 32768) {
      throw new Error('hive_agent_invalid_request')
    }
    const runtime = options.getRuntime()
    if (!runtime) {
      throw new Error('hive_agent_capability_unavailable')
    }
    const project = await runtime.openProject(input.projectSelector)
    options.assertSender()
    if (signal?.aborted || options.getRuntime() !== runtime) {
      throw new Error('hive_agent_forbidden')
    }
    return { project, params: input.params }
  }
  return (Object.keys(HIVE_AGENT_METHODS) as HiveAgentMethod[]).map((method) =>
    method === 'hiveAgent.subscribe'
      ? defineStreamingMethod({
          name: method,
          params: z.unknown(),
          handler: async (raw, context, emit) => {
            if (!context.signal || context.signal.aborted) {
              return
            }
            let close: (() => void) | undefined
            let onAbort = () => {}
            try {
              const { project, params } = await open(method, raw, context.signal)
              close = await project.subscribe(params, (event) => {
                if (context.signal?.aborted) {
                  return
                }
                options.assertSender()
                emit(event)
              })
              await new Promise<void>((resolve) => {
                onAbort = resolve
                context.signal!.addEventListener('abort', onAbort, { once: true })
                if (context.signal!.aborted) {
                  resolve()
                }
              })
            } catch {
              if (!context.signal.aborted) {
                emit(failure())
              }
            } finally {
              context.signal.removeEventListener('abort', onAbort)
              close?.()
            }
          }
        })
      : defineMethod({
          name: method,
          params: z.unknown(),
          handler: async (raw, context) => {
            try {
              const { project, params } = await open(method, raw, context.signal)
              const result = await project.call(method, params)
              options.assertSender()
              return result
            } catch {
              return failure()
            }
          }
        })
  )
}
