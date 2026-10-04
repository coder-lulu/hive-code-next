import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import type { TaskExecutionHost } from './task-execution-host'
import type { TaskExecutionPersistence } from './task-execution-store'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

/** Recovery observes original executions; only the host may clean up revoked writers. */
export function installTaskAuthorizationMonitor(options: {
  issuer: Pick<
    LocalTaskBindingIssuer,
    'assertExecutionCurrent' | 'launchFingerprint' | 'restoreBindings'
  >
  store: Pick<TaskExecutionPersistence, 'readActive'>
  host: Pick<TaskExecutionHost, 'recoverPersistedExecution' | 'fenceRevokedExecution'>
  operationCallerKey: string
  subscribe(listener: () => void): () => void
  assertCurrent(): void
}) {
  let closed = false,
    dirty = false,
    authorizationDirty = false
  let flight: Promise<void> | null = null
  let authorizationFlight: Promise<TaskExecutionRecord[]> | null = null
  const assertCurrent = () => {
    if (closed) {
      return refuseTaskExecution('SERVICE_UNAVAILABLE')
    }
    options.assertCurrent()
  }
  const caller = { operationCallerKey: options.operationCallerKey, assertCurrent }
  const fenceRevoked = () => {
    authorizationDirty = true
    if (authorizationFlight) {
      return authorizationFlight
    }
    authorizationFlight = (async () => {
      let records: TaskExecutionRecord[] = []
      do {
        authorizationDirty = false
        records = (await options.store.readActive(assertCurrent)).filter(
          (record) => record.operationCallerKey === options.operationCallerKey
        )
        await options.issuer.restoreBindings(records)
        assertCurrent()
        const revoked: TaskExecutionRecord[] = [],
          authorized: TaskExecutionRecord[] = []
        for (const record of records) {
          assertCurrent()
          try {
            options.issuer.assertExecutionCurrent(record)
            authorized.push(record)
          } catch {
            revoked.push(record)
          }
        }
        await Promise.allSettled(
          revoked.map(async (record) => {
            assertCurrent()
            await options.host.fenceRevokedExecution(record, caller).catch(() => undefined)
          })
        )
        records = [...revoked, ...authorized]
      } while (!closed && authorizationDirty)
      return records
    })().finally(() => {
      authorizationFlight = null
    })
    void authorizationFlight.catch(() => undefined)
    return authorizationFlight
  }
  const recover = async (records: TaskExecutionRecord[]) => {
    let index = 0
    const lane = async () => {
      while (!closed && index < records.length) {
        const record = records[index++]!
        assertCurrent()
        let fingerprint: string | null = null
        try {
          fingerprint = options.issuer.launchFingerprint(record)
        } catch {
          /* Missing proof keeps the original launch unresolved. */
        }
        await options.host
          .recoverPersistedExecution(record, caller, fingerprint, () =>
            options.issuer.assertExecutionCurrent(record)
          )
          .catch(() => undefined)
      }
    }
    await Promise.allSettled(Array.from({ length: Math.min(4, records.length) }, lane))
  }
  const check = () => {
    if (closed) {
      return flight
    }
    dirty = true
    const authorization = fenceRevoked()
    if (flight) {
      return flight
    }
    flight = (async () => {
      let records = await authorization
      do {
        dirty = false
        await recover(records)
        if (!closed && dirty) {
          records = await fenceRevoked()
        }
      } while (!closed && dirty)
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
  void check()
  return {
    check,
    async close() {
      if (!closed) {
        closed = true
        clearInterval(timer)
        unsubscribe()
      }
      await Promise.allSettled([flight, authorizationFlight])
    }
  }
}
