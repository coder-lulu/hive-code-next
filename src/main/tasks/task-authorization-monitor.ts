import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import type { TaskExecutionHost } from './task-execution-host'
import type { TaskExecutionPersistence } from './task-execution-store'
import type { TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'
import { taskFailure, type TaskFailureError } from './task-failure-diagnostic'
import { TASK_EXECUTION_RECORD_LIMIT } from './task-execution-admission'

/** Recovery observes original executions; only the host may clean up revoked writers. */
export function installTaskAuthorizationMonitor(options: {
  issuer: Pick<
    LocalTaskBindingIssuer,
    'assertExecutionCurrent' | 'launchFingerprint' | 'restoreBindings'
  >
  store: Pick<TaskExecutionPersistence, 'readActive' | 'listActive'>
  host: Pick<TaskExecutionHost, 'recoverPersistedExecution' | 'fenceRevokedExecution'>
  operationCallerKey: string
  subscribe(listener: () => void): () => void
  assertCurrent(): void
}) {
  let closed = false,
    closing = false,
    dirty = false,
    authorizationDirty = false
  let flight: Promise<void> | null = null
  let authorizationFlight: Promise<TaskExecutionRecord[]> | null = null
  let closingFlight: Promise<void> | undefined
  const assertCurrent = () => {
    if (closed) {
      return refuseTaskExecution('SERVICE_UNAVAILABLE')
    }
    options.assertCurrent()
  }
  const caller = { operationCallerKey: options.operationCallerKey, assertCurrent }
  const captured = new Map<
    string,
    {
      record: TaskExecutionRecord
      failure: TaskFailureError
      flight?: Promise<void>
    }
  >()
  const flushCaptured = () => {
    for (const [key, entry] of captured) {
      if (entry.flight) {
        continue
      }
      // The Host queues only its original cancellation CAS here; slow collection stays bounded below.
      entry.flight = options.host
        .fenceRevokedExecution(entry.record, caller, entry.failure)
        .then(
          () => {
            captured.delete(key)
          },
          () => undefined
        )
        .finally(() => {
          entry.flight = undefined
        })
    }
  }
  const captureObservedRevocations = () => {
    if (closing || closed) {
      return
    }
    assertCurrent()
    for (const record of options.store.listActive()) {
      if (
        record.operationCallerKey !== options.operationCallerKey ||
        captured.has(record.commandFingerprint) ||
        captured.size >= TASK_EXECUTION_RECORD_LIMIT
      ) {
        continue
      }
      try {
        if (!options.issuer.launchFingerprint(record)) {
          continue
        }
      } catch {
        continue
      }
      try {
        options.issuer.assertExecutionCurrent(record)
      } catch (error) {
        captured.set(record.commandFingerprint, {
          record,
          failure: taskFailure(error, 'authorization_monitor', 'OUTCOME_UNKNOWN')
        })
      }
    }
    flushCaptured()
  }
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
        if (closing) {
          return records
        }
        await options.issuer.restoreBindings(records)
        assertCurrent()
        const revoked: { record: TaskExecutionRecord; failure: TaskFailureError }[] = [],
          authorized: TaskExecutionRecord[] = []
        for (const record of records) {
          assertCurrent()
          try {
            options.issuer.assertExecutionCurrent(record)
            authorized.push(record)
          } catch (error) {
            revoked.push({
              record,
              failure: taskFailure(error, 'authorization_monitor', 'OUTCOME_UNKNOWN')
            })
          }
        }
        await Promise.allSettled(
          revoked.map(async ({ record, failure }) => {
            assertCurrent()
            await options.host.fenceRevokedExecution(record, caller, failure).catch(() => undefined)
          })
        )
        records = [...revoked.map(({ record }) => record), ...authorized]
      } while (!closing && !closed && authorizationDirty)
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
      while (!closing && !closed && index < records.length) {
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
    if (closing || closed) {
      return flight
    }
    dirty = true
    flushCaptured()
    const authorization = fenceRevoked()
    if (flight) {
      return flight
    }
    flight = (async () => {
      let records = await authorization
      do {
        dirty = false
        await recover(records)
        if (!closing && !closed && dirty) {
          records = await fenceRevoked()
        }
      } while (!closing && !closed && dirty)
    })().finally(() => {
      flight = null
    })
    void flight.catch(() => undefined)
    return flight
  }
  const unsubscribe = options.subscribe(() => {
    try {
      captureObservedRevocations()
    } catch {
      /* Unavailable snapshots grant no authority. */
    }
    void check()
  })
  const timer = setInterval(() => {
    void check()
  }, 5000)
  timer.unref()
  void check()
  return {
    check,
    close() {
      if (closed) {
        return Promise.resolve()
      }
      if (closingFlight) {
        return closingFlight
      }
      closing = true
      clearInterval(timer)
      unsubscribe()
      closingFlight = (async () => {
        await Promise.allSettled([flight, authorizationFlight])
        const pending = [...captured.values()]
        for (let index = 0; index < pending.length; index += 4) {
          await Promise.allSettled(
            pending.slice(index, index + 4).map(async (entry) => {
              if (entry.flight) {
                await entry.flight
              }
              const key = entry.record.commandFingerprint
              if (captured.get(key) === entry) {
                await options.host.fenceRevokedExecution(entry.record, caller, entry.failure)
                captured.delete(key)
              }
            })
          )
        }
        if (captured.size) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
        closed = true
      })().catch((error) => {
        closingFlight = undefined
        throw error
      })
      return closingFlight
    }
  }
}
