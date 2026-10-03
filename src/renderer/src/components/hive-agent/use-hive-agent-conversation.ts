import { useEffect, useRef, useState } from 'react'
import type { HiveAgentSessionAggregate } from '../../../../shared/hive-agent-session-aggregate'
import type { HiveAiModelSelection } from '../../../../shared/hive-ai-model-catalog'
import type { AgentJournalCursor } from '../../../../shared/agent-session-journal-types'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  reduceStructuredAgentSession
} from '../../../../shared/structured-agent-session-reducer'
import { createHiveAgentSessionClient } from '@/runtime/hive-agent-session-client'
import { subscribeHiveAgentSession } from '@/runtime/hive-agent-session-subscription'
import { createAgentSessionOperationId } from '@/runtime/agent-session-operation-id'
import { loadHiveAgentOlderHistory } from './hive-agent-older-history'

export function useHiveAgentConversation(
  accountId: string,
  projectSelector: string,
  sessionId: string
) {
  const [aggregate, setAggregate] = useState<HiveAgentSessionAggregate | null>(null)
  const [timeline, setTimeline] = useState(EMPTY_STRUCTURED_AGENT_SESSION)
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [olderHistoryGeneration, setOlderHistoryGeneration] = useState(0)
  const [revision, setRevision] = useState(0)
  const active = useRef<{
    signal: AbortSignal
    client: ReturnType<typeof createHiveAgentSessionClient>
    refresh: (fresh?: boolean) => Promise<void>
    reconnect: () => void
    writing: boolean
    paging: boolean
    uncertainOperation?: string
    historyRevision: number
  } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const client = createHiveAgentSessionClient({
      projectSelector,
      signal: controller.signal,
      call: window.api.runtime.call
    })
    let reading: Promise<void> | null = null
    const owner = {
      signal: controller.signal,
      client,
      writing: false,
      paging: false,
      historyRevision: 0,
      generationState: '',
      reconnect: () => {},
      uncertainOperation: undefined as string | undefined,
      refresh: async (fresh = false): Promise<void> => {
        if (reading) {
          if (!fresh) {
            return reading
          }
          await reading
        }
        if (controller.signal.aborted) {
          return
        }
        const request = (async () => {
          try {
            const next = await client.read(sessionId)
            if (!controller.signal.aborted) {
              setAggregate(next)
              owner.generationState = next.generation?.state ?? ''
              if (owner.uncertainOperation === next.turn?.clientOperationId) {
                owner.uncertainOperation = undefined
                setUncertain(false)
              }
            }
          } catch (cause) {
            if (!controller.signal.aborted) {
              setAggregate(null)
              setError(cause instanceof Error ? cause.message : 'hive_agent_outcome_unknown')
            }
          }
        })()
        reading = request
        try {
          await request
        } finally {
          if (reading === request) {
            reading = null
          }
        }
      }
    }
    active.current = owner
    setAggregate(null)
    setTimeline(EMPTY_STRUCTURED_AGENT_SESSION)
    setConnected(false)
    setPending(false)
    setUncertain(false)
    setError(null)
    setLoadingEarlier(false)
    void owner.refresh()
    let close = () => {}
    let cursor: AgentJournalCursor | undefined
    const connect = () => {
      if (controller.signal.aborted) {
        return
      }
      close()
      setConnected(false)
      close = subscribeHiveAgentSession({
        projectSelector,
        params: { sessionId, ...(cursor ? { cursor } : {}) },
        signal: controller.signal,
        subscribe: window.api.runtime.subscribe,
        onEvent: (event) => {
          if (event.type === 'reset' && event.reset === 'schema_unreadable') {
            setConnected(false)
            setError('hive_agent_capability_unavailable')
            return
          }
          setConnected(true)
          cursor =
            event.type === 'batch'
              ? event.batch.cursor
              : (event.page.liveCursor ?? event.page.window.nextCursor)
          setError(null)
          if (event.type !== 'batch') {
            owner.historyRevision++
            setOlderHistoryGeneration((generation) => generation + 1)
          }
          setTimeline((state) => reduceStructuredAgentSession(state, { type: 'event', event }))
          if (
            event.type !== 'batch' ||
            event.batch.items.some((item) => item.body.kind === 'turn')
          ) {
            void owner.refresh()
          }
        },
        onClose: (reason) => {
          setConnected(false)
          setError(reason)
        }
      })
    }
    connect()
    owner.reconnect = connect
    const unsubscribe = window.api.hiveAccount.onStateChanged((state) => {
      if (
        state.status !== 'signed-in' ||
        state.account?.accountId !== accountId ||
        state.errorCode
      ) {
        controller.abort()
        setAggregate(null)
        setTimeline(EMPTY_STRUCTURED_AGENT_SESSION)
        setConnected(false)
        setError('hive_agent_forbidden')
      }
    })
    const timer = setInterval(() => {
      if (
        ['PENDING', 'RUNNING', 'UNKNOWN'].includes(owner.generationState) ||
        owner.uncertainOperation
      ) {
        void owner.refresh()
      }
    }, 5000)
    // The host principal is short-lived; renew only the read subscription, never a mutation.
    const renewal = setInterval(connect, 30000)
    return () => {
      controller.abort()
      clearInterval(timer)
      clearInterval(renewal)
      unsubscribe()
      close()
      if (active.current === owner) {
        active.current = null
      }
    }
  }, [accountId, projectSelector, sessionId, revision])

  const mutate = async (text?: string, modelSelection?: HiveAiModelSelection) => {
    const owner = active.current
    if (
      !owner ||
      owner.signal.aborted ||
      owner.writing ||
      owner.uncertainOperation ||
      !aggregate ||
      !connected ||
      uncertain
    ) {
      return false
    }
    owner.writing = true
    setPending(true)
    setError(null)
    let operationId = ''
    try {
      operationId = createAgentSessionOperationId()
      const receipt =
        text !== undefined && modelSelection
          ? await owner.client.mutate('hiveAgent.submit', {
              sessionId,
              operationId,
              text,
              modelSelection
            })
          : await owner.client.mutate('hiveAgent.cancel', {
              sessionId,
              operationId,
              generationId: aggregate.generation?.generationId ?? ''
            })
      if (owner.signal.aborted) {
        return false
      }
      if (receipt.status === 'unknown') {
        owner.uncertainOperation = operationId
        setUncertain(true)
      }
      await owner.refresh(true)
      return receipt.status === 'pending' || receipt.status === 'succeeded'
    } catch (cause) {
      if (!owner.signal.aborted) {
        const message = cause instanceof Error ? cause.message : 'hive_agent_outcome_unknown'
        setError(message)
        if (message === 'hive_agent_outcome_unknown' && operationId) {
          owner.uncertainOperation = operationId
          setUncertain(true)
        }
      }
      return false
    } finally {
      owner.writing = false
      if (!owner.signal.aborted) {
        setPending(false)
      }
    }
  }
  const loadEarlier = () =>
    loadHiveAgentOlderHistory({
      owner: active.current,
      timeline,
      sessionId,
      setTimeline,
      setLoadingEarlier,
      setError
    })
  return {
    aggregate,
    timeline,
    connected,
    pending,
    uncertain,
    error,
    loadingEarlier,
    olderHistoryGeneration,
    submit: (text: string, selection: HiveAiModelSelection) => mutate(text, selection),
    cancel: () => mutate(),
    loadEarlier,
    refresh: () => {
      const owner = active.current
      if (!owner || owner.signal.aborted || owner.writing) {
        return
      }
      if (uncertain || owner.uncertainOperation) {
        void owner.refresh()
        owner.reconnect()
        return
      }
      setRevision((value) => value + 1)
    }
  }
}
