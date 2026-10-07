import { randomUUID } from 'node:crypto'
import { assertSynchronousAuthorization } from '../../shared/synchronous-authorization-guard'
import { createTaskModelPolicy } from './task-model-policy'
import { createTaskModelSseReader } from './task-model-sse'
import { acquireTaskModelAccountStream } from './task-model-account-stream'
import { taskFailure, type TaskFailureError } from './task-failure-diagnostic'
import {
  abortTaskModelWait,
  decodeTaskModelBody,
  releaseTaskModelRequest,
  requireTaskModelParams,
  type TaskModelActiveRequest as ActiveRequest,
  type TaskModelBrokerOptions
} from './task-model-broker-io'
import { freezeTaskModelAuthScope, openTaskModelUpstream } from './task-model-broker-upstream'
import {
  TASK_MODEL_CHUNK_BYTES,
  TASK_MODEL_IDLE_TIMEOUT_MS,
  TASK_MODEL_REQUEST_BYTES,
  TASK_MODEL_REQUEST_LIMIT,
  TASK_MODEL_REQUEST_TIMEOUT_MS,
  TASK_MODEL_RESPONSE_BYTES,
  type TaskModelChannel
} from './task-model-channel-protocol'

/** The caller binds this channel to the original Task/AgentSession lease, not a guest frame. */
export function createTaskModelBroker(options: TaskModelBrokerOptions): TaskModelChannel {
  const scope = freezeTaskModelAuthScope(options.authScope)
  const deadline = options.deadline
  if (!Number.isSafeInteger(deadline)) {
    throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
  }
  const responsesLite = options.profile.responsesLite
  const modelSessionId = randomUUID()
  const policy = createTaskModelPolicy(options.profile)
  const listeners = new Set<(failure: TaskFailureError) => void>()
  const seenIds = new Set<string>()
  let active: ActiveRequest | undefined
  let closed = false
  let firstFailure: TaskFailureError | undefined
  let failureRecording: Promise<unknown> | undefined
  let dispatches = 0
  let requestBytes = 0
  let responseBytes = 0

  const release = (state: ActiveRequest) => {
    releaseTaskModelRequest(state)
    if (active === state) {
      active = undefined
    }
  }
  const fail = (failure: TaskFailureError): TaskFailureError => {
    if (!firstFailure) {
      firstFailure = failure
      closed = true
      try {
        failureRecording = options.recordFailure?.(failure).catch(() => undefined)
      } catch {
        /* Failed diagnostics never admit effects or prevent cleanup. */
      }
      for (const listener of listeners) {
        try {
          listener(failure)
        } catch {
          /* One observer cannot stop aborting the fenced channel. */
        }
      }
      listeners.clear()
      if (active) {
        release(active)
      }
    }
    return firstFailure ?? failure
  }
  const guard = () => {
    if (closed) {
      throw new Error('TASK_MODEL_CHANNEL_UNAVAILABLE')
    }
    if (Date.now() >= deadline) {
      throw fail(taskFailure(undefined, 'authority', 'TASK_MODEL_DEADLINE_EXCEEDED'))
    }
    try {
      assertSynchronousAuthorization(
        () => options.assertCurrent(scope),
        () => {
          throw new Error('TASK_MODEL_AUTHORITY_REVOKED')
        }
      )
    } catch (error) {
      throw fail(taskFailure(error, 'authority', 'TASK_MODEL_AUTHORITY_REVOKED'))
    }
  }
  const current = (requestId: unknown) => {
    guard()
    if (!active || active.requestId !== requestId) {
      throw new Error('TASK_MODEL_REQUEST_REFUSED')
    }
    return active
  }

  return {
    async start(params) {
      guard()
      let state: ActiveRequest | undefined
      let phase: 'request' | 'reservation' | 'auth' | 'fetch' | 'response' | 'stream' = 'request'
      try {
        const parsed = requireTaskModelParams(params, ['requestId', 'bodyBase64'])
        const requestId = String(parsed.requestId)
        const body = policy.request(decodeTaskModelBody(parsed.bodyBase64))
        const length = Buffer.byteLength(body)
        if (
          active ||
          seenIds.has(requestId) ||
          dispatches >= TASK_MODEL_REQUEST_LIMIT ||
          length > TASK_MODEL_REQUEST_BYTES ||
          requestBytes + length > TASK_MODEL_REQUEST_LIMIT * TASK_MODEL_REQUEST_BYTES
        ) {
          throw new Error('TASK_MODEL_BUDGET_REFUSED')
        }
        const releaseAccount = acquireTaskModelAccountStream(scope.providerAccountId)
        dispatches++
        requestBytes += length
        seenIds.add(requestId)
        const controller = new AbortController()
        const timer = setTimeout(
          () =>
            fail(
              taskFailure(
                undefined,
                phase,
                'TASK_MODEL_DEADLINE_EXCEEDED',
                phase === 'stream' ? 200 : undefined
              )
            ),
          Math.min(TASK_MODEL_REQUEST_TIMEOUT_MS, deadline - Date.now())
        )
        timer.unref()
        state = {
          requestId,
          controller,
          timer,
          stream: createTaskModelSseReader(policy.event),
          sequence: 0,
          pulling: false,
          releaseAccount
        }
        active = state
        phase = 'reservation'
        await abortTaskModelWait(options.reserveDispatch(), controller.signal)
        guard()
        if (active !== state) {
          throw new Error('TASK_MODEL_REQUEST_ABORTED')
        }
        state.stream = createTaskModelSseReader(policy.responseEvent(body))
        phase = 'fetch'
        state.reader = await openTaskModelUpstream({
          scope,
          body,
          requestId,
          modelSessionId,
          responsesLite,
          signal: controller.signal,
          readAuth: options.readAuth,
          request: options.request,
          onPhase: (currentPhase) => {
            phase = currentPhase
          },
          assertCurrent: () => {
            guard()
            if (active !== state) {
              throw new Error('TASK_MODEL_REQUEST_ABORTED')
            }
          }
        })
        phase = 'stream'
        guard()
        if (active !== state) {
          throw new Error('TASK_MODEL_REQUEST_ABORTED')
        }
        return { status: 200, contentType: 'text/event-stream' }
      } catch (error) {
        const failure = fail(taskFailure(error, phase, 'TASK_MODEL_UPSTREAM_UNAVAILABLE'))
        if (state) {
          release(state)
        }
        throw failure
      }
    },
    async next(params) {
      guard()
      try {
        const parsed = requireTaskModelParams(params, ['requestId', 'sequence'])
        const state = current(parsed.requestId)
        if (
          !Number.isSafeInteger(parsed.sequence) ||
          parsed.sequence !== state.sequence ||
          state.pulling ||
          !state.reader
        ) {
          throw new Error('TASK_MODEL_REQUEST_REFUSED')
        }
        state.pulling = true
        try {
          while (state.stream.pendingBytes === 0 && !state.stream.completed) {
            const idle = setTimeout(
              () => fail(taskFailure(undefined, 'stream', 'TASK_MODEL_IDLE_TIMEOUT', 200)),
              TASK_MODEL_IDLE_TIMEOUT_MS
            )
            idle.unref()
            try {
              const chunk = await abortTaskModelWait(state.reader.read(), state.controller.signal)
              guard()
              if (active !== state) {
                throw new Error('TASK_MODEL_REQUEST_ABORTED')
              }
              if (chunk.done) {
                state.stream.finish()
              } else {
                if (chunk.value.byteLength === 0) {
                  throw new Error('TASK_MODEL_STREAM_REFUSED')
                }
                responseBytes += chunk.value.byteLength
                if (responseBytes > TASK_MODEL_RESPONSE_BYTES) {
                  throw new Error('TASK_MODEL_BUDGET_REFUSED')
                }
                state.stream.feed(chunk.value)
              }
            } finally {
              clearTimeout(idle)
            }
          }
          const bytes = state.stream.take(TASK_MODEL_CHUNK_BYTES)
          const done = state.stream.completed && state.stream.pendingBytes === 0
          guard()
          if (active !== state) {
            throw new Error('TASK_MODEL_REQUEST_ABORTED')
          }
          const sequence = state.sequence++
          if (done) {
            state.stream.finish()
            release(state)
          }
          return { sequence, bodyBase64: bytes.toString('base64'), done }
        } finally {
          state.pulling = false
        }
      } catch (error) {
        throw fail(
          taskFailure(
            error,
            'stream',
            'TASK_MODEL_STREAM_REFUSED',
            active?.reader ? 200 : undefined
          )
        )
      }
    },
    async cancel(params) {
      try {
        guard()
        const parsed = requireTaskModelParams(params, ['requestId'])
        if (!seenIds.has(String(parsed.requestId))) {
          throw new Error('TASK_MODEL_REQUEST_REFUSED')
        }
        if (active?.requestId === parsed.requestId) {
          // A disconnected model turn cannot overlap a fresh upstream request.
          fail(taskFailure(undefined, 'channel', 'TASK_MODEL_REQUEST_ABORTED'))
        }
        return { cancelled: true }
      } catch {
        throw fail(taskFailure(undefined, 'channel', 'TASK_MODEL_REQUEST_REFUSED'))
      }
    },
    onFailure(listener) {
      if (firstFailure) {
        queueMicrotask(() => {
          try {
            listener(firstFailure!)
          } catch {
            /* A late observer cannot escape the failed channel. */
          }
        })
      } else if (!closed) {
        listeners.add(listener)
      }
      return () => listeners.delete(listener)
    },
    async close() {
      closed = true
      if (active) {
        release(active)
      }
      listeners.clear()
      await failureRecording
    }
  }
}
