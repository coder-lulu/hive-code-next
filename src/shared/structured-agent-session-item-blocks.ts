import { agentJournalToolCallLifecycle } from './agent-journal-tool-call-lifecycle'
import { structuredAgentSessionStatusBlock } from './structured-agent-session-status-block'
import type { AgentJournalRenderItem } from './agent-session-journal-types'
import type { NativeChatBlock, NativeChatMessage } from './native-chat-types'
import {
  isStructuredAgentSessionToolAction,
  structuredAgentSessionToolCallBlock
} from './structured-agent-session-tool-call-block'

function boundedText(payload: { head: string; truncated: boolean; byteLength: number }): string {
  return payload.truncated ? `${payload.head}\n… (${payload.byteLength} bytes)` : payload.head
}

export function itemBlocks(item: AgentJournalRenderItem): {
  role: NativeChatMessage['role']
  blocks: NativeChatBlock[]
} | null {
  const body = item.body
  if (body.kind === 'message') {
    return { role: body.role, blocks: body.blocks }
  }
  if (isStructuredAgentSessionToolAction(body)) {
    const call = structuredAgentSessionToolCallBlock(body, item.itemId)
    // The call and its output are one journal row, so the result names its call.
    const { callId } = call
    if (body.kind === 'diff') {
      return {
        role: 'assistant',
        blocks: [call, { type: 'tool-result', output: boundedText(body.patch), callId }]
      }
    }
    return {
      role: 'assistant',
      blocks: [
        call,
        ...(body.output
          ? [
              {
                type: 'tool-result' as const,
                output: boundedText(body.output),
                // Output a call left when it was cut short is not an error it reported.
                isError: agentJournalToolCallLifecycle(body) === 'failed',
                callId
              }
            ]
          : [])
      ]
    }
  }
  if (body.kind === 'approval') {
    if (body.resolution.state === 'pending') {
      return null
    }
    return {
      role: 'system',
      blocks: [
        {
          type: 'text',
          text: `${body.title}\n${body.detail ?? ''}\n${body.resolution.state}`.trim()
        }
      ]
    }
  }
  if (body.kind === 'question') {
    if (body.resolution.state === 'pending') {
      return null
    }
    const choices = body.options.map((option) => option.label).join(' · ')
    return {
      role: 'system',
      blocks: [{ type: 'text', text: `${body.question}\n${choices}`.trim() }]
    }
  }
  // A turn record is timing, not content; a kind this build does not know is
  // never painted as text either, so a newer host can add kinds freely.
  if (body.kind !== 'status' || body.turnLifecycle) {
    return null
  }
  return { role: 'system', blocks: [structuredAgentSessionStatusBlock(body)] }
}
