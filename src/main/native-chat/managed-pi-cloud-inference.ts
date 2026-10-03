import type { HiveAiTextGrantClient } from '../hive-runtime-cloud/hive-ai-text-grant-client'
import type { HiveAiTextStreamClient } from '../hive-runtime-cloud/hive-ai-text-stream-client'
import type { HiveRuntimeCloudIdentity } from '../hive-runtime-cloud/hive-runtime-cloud-identity-store'
import type { HiveAiRuntimeOwner } from '../../shared/hive-ai-text-control'
import {
  parseHiveAiTextGrantRequest,
  type HiveAiTextGrantRequest
} from '../../shared/hive-ai-text-grant-request'
import { hiveAgentTextExecutionBindingSchema } from '../../shared/hive-agent-text-pack'
import type { ManagedPiInferenceEvent } from '../../shared/managed-pi-process-protocol'
import type { ManagedPiTextInference } from './managed-pi-inference-pump'
import type { ManagedPiCloudRequest } from './managed-pi-cloud-request'

export type ManagedPiCloudAuthority = Readonly<{
  runtime: HiveAiTextGrantRequest['runtime']
  projectScope: string
  owner: HiveAiRuntimeOwner
  identity: HiveRuntimeCloudIdentity
  authorityId: string
  accessToken: string
  assertCurrent: () => void
}>

/** The host supplies current authority; the Pack process never receives Cloud credentials. */
export function createManagedPiCloudInference(options: {
  grants: Pick<HiveAiTextGrantClient, 'issue'>
  streams: Pick<HiveAiTextStreamClient, 'execute'>
  resolve: (request: ManagedPiCloudRequest, signal: AbortSignal) => Promise<ManagedPiCloudAuthority>
}): ManagedPiTextInference {
  return {
    async *run(input) {
      const controller = new AbortController()
      const abort = () => controller.abort()
      input.signal.addEventListener('abort', abort, { once: true })
      if (input.signal.aborted) {
        abort()
      }
      const channel = new TransformStream<ManagedPiInferenceEvent, ManagedPiInferenceEvent>()
      const writer = channel.writable.getWriter()
      const reader = channel.readable.getReader()
      const cancelled = () => {
        void reader.cancel().catch(() => undefined)
      }
      controller.signal.addEventListener('abort', cancelled, { once: true })
      const produce = async () => {
        if (controller.signal.aborted) {
          throw new Error('cancelled')
        }
        const binding = hiveAgentTextExecutionBindingSchema.parse(input.executionBinding)
        if (binding.protocol !== input.request.protocol) {
          throw new Error('binding mismatch')
        }
        const authority = await options.resolve(input.request, controller.signal)
        const assertCurrent = () => {
          authority.assertCurrent()
          if (controller.signal.aborted) {
            throw new Error('cancelled')
          }
        }
        assertCurrent()
        const command = parseHiveAiTextGrantRequest({
          runtime: authority.runtime,
          projectScope: authority.projectScope,
          request: input.request,
          pack: {
            packRevision: binding.packRevision,
            profileId: binding.profileId,
            toolPolicy: binding.toolPolicy,
            inputLimit: binding.maxInputTokens,
            outputLimit: binding.maxOutputTokens
          }
        })
        const credentials = {
          owner: Object.freeze({ ...authority.owner }),
          identity: Object.freeze({ ...authority.identity }),
          accessToken: authority.accessToken,
          authorityId: authority.authorityId,
          assertCurrent,
          signal: controller.signal
        }
        const grant = await options.grants.issue({ ...credentials, command })
        assertCurrent()
        let text = '',
          bytes = 0
        const result = await options.streams.execute({
          ...credentials,
          command,
          grant,
          onText: async (delta) => {
            assertCurrent()
            bytes += Buffer.byteLength(delta)
            if (bytes > 1024 * 1024) {
              throw new Error('output limit')
            }
            text += delta
            await writer.write({ type: 'text', text: delta })
            assertCurrent()
          }
        })
        assertCurrent()
        if (
          result.replay ||
          result.state !== 'COMPLETED' ||
          result.execution?.status !== 'COMPLETED' ||
          result.execution.reason !== 'TERMINAL' ||
          !text
        ) {
          throw new Error('unconfirmed outcome')
        }
        await writer.write({ type: 'completed', text })
        assertCurrent()
        await writer.close()
      }
      const producing = produce().catch(async () => {
        await writer.abort(new Error('hive_agent_outcome_unknown')).catch(() => undefined)
      })
      try {
        while (true) {
          const next = await reader.read()
          if (controller.signal.aborted) {
            throw new Error('hive_agent_outcome_unknown')
          }
          if (next.done) {
            break
          }
          yield next.value
        }
      } catch {
        throw new Error('hive_agent_outcome_unknown')
      } finally {
        input.signal.removeEventListener('abort', abort)
        controller.abort()
        controller.signal.removeEventListener('abort', cancelled)
        void producing
        reader.releaseLock()
      }
    }
  }
}
