import type { Dispatch, SetStateAction } from 'react'
import {
  reduceStructuredAgentSession,
  type StructuredAgentSessionState
} from '../../../../shared/structured-agent-session-reducer'
import type { NativeChatOlderPageResult } from '../native-chat/native-chat-pagination'
import type { createHiveAgentSessionClient } from '@/runtime/hive-agent-session-client'

type HistoryOwner = {
  signal: AbortSignal
  client: Pick<ReturnType<typeof createHiveAgentSessionClient>, 'history'>
  paging: boolean
  historyRevision: number
}

export async function loadHiveAgentOlderHistory({
  owner,
  timeline,
  sessionId,
  setTimeline,
  setLoadingEarlier,
  setError
}: {
  owner: HistoryOwner | null
  timeline: StructuredAgentSessionState
  sessionId: string
  setTimeline: Dispatch<SetStateAction<StructuredAgentSessionState>>
  setLoadingEarlier: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
}): Promise<NativeChatOlderPageResult> {
  const first = timeline.items[0]
  if (!timeline.hasOlder) {
    return 'exhausted'
  }
  if (!owner || owner.signal.aborted || owner.paging || !timeline.epoch || !first) {
    return 'unchanged'
  }
  owner.paging = true
  setLoadingEarlier(true)
  const cursor = { epoch: timeline.epoch, sequence: first.sequence }
  const historyRevision = owner.historyRevision
  try {
    const result = await owner.client.history({ sessionId, direction: 'before', cursor })
    if (owner.signal.aborted || historyRevision !== owner.historyRevision) {
      return 'superseded'
    }
    setTimeline((state) =>
      reduceStructuredAgentSession(
        state,
        result.ok
          ? { type: 'older-page', requestedCursor: cursor, page: result.page }
          : { type: 'history-page', page: result.page }
      )
    )
    if (!result.ok || result.page.epoch !== cursor.epoch) {
      return 'superseded'
    }
    if (result.page.items.some((item) => item.sequence < first.sequence)) {
      return 'applied'
    }
    return result.page.hasOlder ? 'unchanged' : 'exhausted'
  } catch {
    if (!owner.signal.aborted) {
      setError('hive_agent_outcome_unknown')
    }
    return owner.signal.aborted ? 'superseded' : 'failed'
  } finally {
    owner.paging = false
    if (!owner.signal.aborted) {
      setLoadingEarlier(false)
    }
  }
}
