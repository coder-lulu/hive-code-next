import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  HiveWorkflowCaseSessionPage,
  HiveWorkflowCaseSessionRead
} from '../../../../../shared/hive-workflow-case-session'
import {
  EMPTY_STRUCTURED_AGENT_SESSION,
  oldestStructuredAgentSessionCursor,
  reduceStructuredAgentSession,
  type StructuredAgentSessionState
} from '../../../../../shared/structured-agent-session-reducer'
import { stringifyJsonWithinByteLimit } from '../../../../../shared/node-bounded-json-stringify'
import type { NativeChatOlderPageResult } from '@/components/native-chat/native-chat-pagination'
import { useHiveWorkflowCaseSessionAccount } from './use-hive-workflow-case-session-account'
import {
  readWorkflowCaseSessionPage,
  workflowCaseSessionKey
} from './hive-workflow-case-session-responses'

const MAX_SESSION_PAGES = 10
const MAX_SESSION_ITEMS = 20_000
const MAX_SESSION_BYTES = 8 * 1024 * 1024
type ReadState = {
  scope: string
  original: Pick<HiveWorkflowCaseSessionPage, 'sessionId' | 'workspaceId'> | null
  timeline: StructuredAgentSessionState
  pending: 'tail' | 'before' | null
  error: string | null
  limited: boolean
  historyReset: boolean
  historyGeneration: number
}
const emptyState = (scope: string): ReadState => ({
  scope,
  original: null,
  timeline: EMPTY_STRUCTURED_AGENT_SESSION,
  pending: null,
  error: null,
  limited: false,
  historyReset: false,
  historyGeneration: 0
})
type Flight = { direction: 'tail' | 'before'; promise: Promise<NativeChatOlderPageResult> }

export function useHiveWorkflowCaseSession(query: HiveWorkflowCaseSessionRead) {
  const scope = workflowCaseSessionKey(query)
  const [state, setState] = useState(() => emptyState(scope))
  const selected = useRef(query)
  const currentState = useRef(state)
  const mounted = useRef(false)
  const revoked = useRef(false)
  const generation = useRef(0)
  const flight = useRef<Flight | null>(null)
  const pages = useRef(0)
  const original = useRef<ReadState['original']>(null)
  const publish = useCallback((next: ReadState) => {
    currentState.current = next
    setState(next)
  }, [])
  const invalidate = useCallback(() => {
    revoked.current = true
    generation.current += 1
    flight.current = null
    original.current = null
    pages.current = 0
    publish({ ...emptyState(workflowCaseSessionKey(selected.current)), error: 'FORBIDDEN' })
  }, [publish])
  const account = useHiveWorkflowCaseSessionAccount(invalidate)
  useLayoutEffect(() => {
    selected.current = query
  })
  useLayoutEffect(() => {
    mounted.current = true
    generation.current += 1
    flight.current = null
    original.current = null
    pages.current = 0
    publish(emptyState(scope))
    return () => {
      mounted.current = false
      generation.current += 1
      flight.current = null
      original.current = null
      currentState.current = emptyState(scope)
    }
  }, [scope, publish])
  const read = useCallback(
    (direction: 'tail' | 'before'): Promise<NativeChatOlderPageResult> => {
      if (!mounted.current || revoked.current || !account.allowed.current) {
        return Promise.resolve('superseded')
      }
      if (account.deadline.current !== undefined && account.deadline.current <= Date.now()) {
        invalidate()
        return Promise.resolve('superseded')
      }
      if (flight.current) {
        return direction === flight.current.direction
          ? flight.current.promise
          : Promise.resolve('unchanged')
      }
      const previous = currentState.current
      const cursor = oldestStructuredAgentSessionCursor(previous.timeline)
      if (direction === 'before' && !previous.timeline.hasOlder) {
        return Promise.resolve('exhausted')
      }
      if (direction === 'before' && (previous.limited || previous.historyReset || !cursor)) {
        return Promise.resolve('unchanged')
      }
      if (direction === 'before' && pages.current >= MAX_SESSION_PAGES) {
        publish({ ...previous, limited: true })
        return Promise.resolve('unchanged')
      }
      const base = selected.current
      const request: HiveWorkflowCaseSessionRead =
        direction === 'before' && cursor
          ? {
              projectId: base.projectId,
              caseId: base.caseId,
              taskId: base.taskId,
              runId: base.runId,
              direction,
              cursor,
              limit: 40
            }
          : {
              projectId: base.projectId,
              caseId: base.caseId,
              taskId: base.taskId,
              runId: base.runId,
              direction: 'tail',
              limit: 40
            }
      const epoch = generation.current
      const token: Flight = { direction, promise: Promise.resolve('superseded') }
      const current = () =>
        mounted.current &&
        !revoked.current &&
        account.allowed.current &&
        generation.current === epoch &&
        flight.current === token &&
        workflowCaseSessionKey(selected.current) === workflowCaseSessionKey(request)
      flight.current = token
      publish({ ...previous, pending: direction, error: null })
      token.promise = Promise.resolve().then(async () => {
        if (!current()) {
          return 'superseded'
        }
        try {
          const value = await window.api.hiveTasks.getWorkflowCaseSessionPage(request)
          if (!current()) {
            return 'superseded'
          }
          if (account.deadline.current !== undefined && account.deadline.current <= Date.now()) {
            invalidate()
            return 'superseded'
          }
          const result = readWorkflowCaseSessionPage(value, request, original.current)
          const page = result.history.page
          const reset = !result.history.ok
          if (!result.history.ok && result.history.reset === 'schema_unreadable') {
            throw new Error('SESSION_UNAVAILABLE')
          }
          const timeline = reduceStructuredAgentSession(
            direction === 'tail' || reset ? EMPTY_STRUCTURED_AGENT_SESSION : previous.timeline,
            direction === 'before' && cursor && !reset
              ? { type: 'older-page', requestedCursor: cursor, page }
              : { type: 'history-page', page }
          )
          if (
            timeline.items.length > MAX_SESSION_ITEMS ||
            timeline.submissions.length > MAX_SESSION_ITEMS ||
            (timeline.subagentRoster?.size ?? 0) > MAX_SESSION_ITEMS
          ) {
            publish({ ...previous, pending: null, limited: true })
            return 'unchanged'
          }
          try {
            stringifyJsonWithinByteLimit(
              { ...timeline, subagentRoster: [...(timeline.subagentRoster?.values() ?? [])] },
              MAX_SESSION_BYTES
            )
          } catch {
            publish({ ...previous, pending: null, limited: true })
            return 'unchanged'
          }
          original.current = { sessionId: result.sessionId, workspaceId: result.workspaceId }
          pages.current = direction === 'tail' ? 1 : pages.current + 1
          publish({
            ...previous,
            original: original.current,
            timeline,
            pending: null,
            error: null,
            limited: pages.current >= MAX_SESSION_PAGES && timeline.hasOlder,
            historyReset: direction === 'before' && reset,
            historyGeneration: previous.historyGeneration + (direction === 'tail' || reset ? 1 : 0)
          })
          if (reset) {
            return 'unchanged'
          }
          if (direction === 'tail') {
            return 'applied'
          }
          if (!page.items.length) {
            return page.hasOlder ? 'unchanged' : 'exhausted'
          }
          return oldestStructuredAgentSessionCursor(timeline)?.sequence !== cursor?.sequence
            ? 'applied'
            : 'unchanged'
        } catch (failure) {
          if (!current()) {
            return 'superseded'
          }
          const error = failure instanceof Error ? failure.message : 'SERVICE_UNAVAILABLE'
          if (error.includes('FORBIDDEN')) {
            invalidate()
          } else {
            pages.current = 0
            publish({
              ...emptyState(previous.scope),
              error,
              historyGeneration: previous.historyGeneration + 1
            })
          }
          return 'failed'
        } finally {
          if (current()) {
            flight.current = null
            publish({ ...currentState.current, pending: null })
          }
        }
      })
      return token.promise
    },
    [account.allowed, account.deadline, invalidate, publish]
  )
  useEffect(() => {
    if (account.ready) {
      void read('tail')
    }
  }, [scope, account.ready, read])
  const visible = state.scope === scope ? state : emptyState(scope)
  return {
    ...visible,
    ready: account.ready && !revoked.current,
    busy: visible.pending !== null,
    refresh: () => read('tail'),
    loadEarlier: () => read('before')
  }
}
