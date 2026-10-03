import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import type { TaskExecutionHost } from './task-execution-host'
import type { TaskExecutionPersistence } from './task-execution-store'

/** Only already-issued executions are stopped; identity loss never grants a new execution. */
export function installTaskAuthorizationMonitor(options: {
  issuer: Pick<LocalTaskBindingIssuer, 'issuedBindings' | 'resolveGrant'>
  store: Pick<TaskExecutionPersistence, 'get'>
  host: Pick<TaskExecutionHost, 'cancelRevokedExecution'>
  subscribe(listener: () => void): () => void
  assertCurrent(): void
}) {
  let closed = false
  let flight: Promise<void> | null = null
  const check = () => {
    if (closed || flight) {
      return flight
    }
    flight = (async () => {
      for (const binding of options.issuer.issuedBindings()) {
        if (closed) {
          return
        }
        const record = options.store.get(binding.command)
        if (!record || record.result) {
          continue
        }
        const grant = options.issuer.resolveGrant(binding.command.authorizationRef)
        try {
          if (!grant) {
            throw new Error('FORBIDDEN')
          }
          grant.assertCurrent()
        } catch {
          await options.host
            .cancelRevokedExecution(record, {
              operationCallerKey: record.operationCallerKey,
              assertCurrent: options.assertCurrent
            })
            .catch(() => undefined)
        }
      }
    })().finally(() => {
      flight = null
    })
    void flight.catch(() => undefined)
    return flight
  }
  const unsubscribe = options.subscribe(() => {
    void check()
  })
  const timer = setInterval(() => {
    void check()
  }, 5000)
  timer.unref()
  return {
    check,
    async close() {
      if (closed) {
        await flight
        return
      }
      closed = true
      clearInterval(timer)
      unsubscribe()
      await flight
    }
  }
}
