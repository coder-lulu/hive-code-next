import { createHash } from 'node:crypto'
import * as claudeConnection from './claude-stream-json-connection'
import { readWindowsProcessCreationTime } from '../windows/windows-process-table'
import type { ClaudeStructuredSessionAdapterDeps } from './claude-structured-session-state'
import type { ClaudeStructuredSessionEvent } from './claude-structured-session-adapter'

export function commandLifecycleIndex(
  events: ClaudeStructuredSessionEvent[],
  uuid: string | undefined,
  state: 'queued' | 'started'
): number {
  return events.findIndex(
    (event) =>
      typeof uuid === 'string' &&
      event.type === 'message' &&
      event.message.type === 'command_lifecycle' &&
      event.message.command_uuid === uuid &&
      event.message.state === state
  )
}

export function observedFailure(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : ''
  return {
    errorClass: error instanceof Error ? error.name : typeof error,
    httpStatuses: [...message.matchAll(/\b(?:401|403|408|429|5\d\d)\b/g)].map(([code]) => code),
    timeout: /timed? ?out|timeout/i.test(message)
  }
}

type ClaudeStreamDiagnostic = { type: string }

function parseClaudeStreamDiagnostic(value: unknown): ClaudeStreamDiagnostic | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return undefined
  }
  const type = value.type
  return typeof type === 'string' ? { type } : undefined
}

export function streamObjectType(
  value: unknown,
  key?: 'delta' | 'content_block'
): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const nested =
    key === undefined
      ? value
      : key === 'delta' && 'delta' in value
        ? value.delta
        : key === 'content_block' && 'content_block' in value
          ? value.content_block
          : undefined
  return parseClaudeStreamDiagnostic(nested)?.type
}

export function observeRealClaudeConnection(
  record: (row: Record<string, unknown>) => void,
  sent: string[]
): NonNullable<ClaudeStructuredSessionAdapterDeps['openConnection']> {
  return async (launch, handlers) => {
    record({ type: 'open-connection' })
    const connection = await claudeConnection.openClaudeStreamJsonConnection(launch, handlers)
    const rootPid = connection.pid
    const rootBirth =
      process.platform === 'win32' && rootPid !== undefined
        ? readWindowsProcessCreationTime(rootPid)
        : undefined
    record({ type: 'owned-root', rootPid, rootBirth })
    const recordClose = (type: string, detail: Record<string, unknown> = {}) =>
      record({ type, rootPid, rootBirth, ...connection.exitVerdict, ...detail })
    const close = connection.close.bind(connection)
    connection.close = async () => {
      recordClose('connection-close-before')
      try {
        const closed = await close()
        recordClose('connection-close-after', { closed })
        return closed
      } catch (error) {
        recordClose('connection-close-error', observedFailure(error))
        throw error
      }
    }
    const send = connection.send.bind(connection)
    connection.send = async (message, beforeDispatch) => {
      if (message.type === 'user' && typeof message.uuid === 'string') {
        sent.push(message.uuid)
        record({
          type: 'send-user',
          uuidHash: createHash('sha256').update(message.uuid).digest('hex')
        })
      }
      await send(message, beforeDispatch)
    }
    const interrupt = connection.interrupt.bind(connection)
    connection.interrupt = async (options) => {
      record({ type: 'interrupt-request', cancelQueued: options?.cancelQueued === true })
      try {
        const receipt = await interrupt(options)
        const ids = (values: readonly string[] | undefined) =>
          values?.map((value) => createHash('sha256').update(value).digest('hex'))
        record({
          type: 'interrupt-response',
          receiptPresent: receipt !== undefined,
          cancelled: ids(receipt?.cancelled),
          stillQueued: ids(receipt?.still_queued)
        })
        return receipt
      } catch (error) {
        record({ type: 'interrupt-error', ...observedFailure(error) })
        throw error
      }
    }
    return connection
  }
}
