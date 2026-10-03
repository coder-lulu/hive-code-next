import {
  parseManagedPiInferenceEvent,
  type ManagedPiTextRequest,
  type ManagedPiInferenceEvent
} from '../../shared/managed-pi-process-protocol'
import type { ManagedPiProcessTransport } from '../runtime/managed-pi-process-transport'
import { createManagedPiCloudRequest, type ManagedPiCloudRequest } from './managed-pi-cloud-request'

/** Mandatory parent-side Hive inference port; it must observe cancellation. */
export type ManagedPiTextInference = {
  run(
    input: Readonly<{
      request: ManagedPiCloudRequest
      executionBinding: ManagedPiTextRequest['executionBinding']
      signal: AbortSignal
    }>
  ): AsyncIterable<ManagedPiInferenceEvent>
}
export async function pumpManagedPiInference(input: {
  request: Readonly<ManagedPiTextRequest>
  signal: AbortSignal
  transport: ManagedPiProcessTransport
  inference: ManagedPiTextInference
  assertCurrent: () => void
  timeoutMs: number
}): Promise<void> {
  let sequence = 0,
    bytes = 0,
    completed = false
  const request = createManagedPiCloudRequest(input.request)
  const command = Object.freeze({
    request,
    executionBinding: Object.freeze({ ...input.request.executionBinding }),
    signal: input.signal
  })
  input.assertCurrent()
  if (input.signal.aborted) {
    throw new Error('hive_agent_outcome_unknown')
  }
  for await (const raw of input.inference.run(command)) {
    input.assertCurrent()
    if (input.signal.aborted || completed) {
      throw new Error('hive_agent_outcome_unknown')
    }
    const event = parseManagedPiInferenceEvent(raw)
    if (++sequence > 1000) {
      throw new Error('hive_agent_outcome_unknown')
    }
    if (event.type === 'text') {
      bytes += Buffer.byteLength(event.text)
      if (bytes > 1024 * 1024 || sequence > 999) {
        throw new Error('hive_agent_outcome_unknown')
      }
    } else {
      completed = true
    }
    await input.transport.exchange(
      { type: 'inference.event', generationId: request.generationId, sequence, event },
      'inference.ack',
      (frame) => frame.generationId === request.generationId && frame.sequence === sequence,
      input.timeoutMs
    )
  }
  input.assertCurrent()
  if (input.signal.aborted || !completed) {
    throw new Error('hive_agent_outcome_unknown')
  }
}
