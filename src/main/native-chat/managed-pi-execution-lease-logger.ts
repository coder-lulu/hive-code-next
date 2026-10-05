import {
  createStructuredAgentSessionLogger,
  type StructuredAgentSessionLogger
} from './agent-session-wire/structured-agent-session-logger'

export function createManagedPiExecutionLeaseLogger(input: {
  now: () => number
  recordId: string
  dispose: () => Promise<void>
}): StructuredAgentSessionLogger {
  const logger = createStructuredAgentSessionLogger({ now: input.now })
  return {
    error: logger.error,
    warn(message, fields) {
      logger.warn(message, fields)
      void input.dispose().catch((error) =>
        logger.error('disposing a failed managed Pi owner failed', {
          scope: 'managed-pi-dispose',
          sessionId: input.recordId,
          error
        })
      )
    }
  }
}
