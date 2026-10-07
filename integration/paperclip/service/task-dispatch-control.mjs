import { createExternalExecutionLifecycle } from '@hive-paperclip-external-execution'
import { refuseTaskRepository as refuse } from './task-delivery-repository.mjs'

export function createTaskDispatchControl({ repository, flights, reserve }) {
  const externalRun = (accountId, task) => ({
    id: task.run_id,
    companyId: task.company_id,
    driverKind: task.driver_kind,
    status: task.run_status,
    accountId,
    taskId: task.id
  })
  const scopeFor = (run) => ({ companyId: run.companyId, runId: run.id })
  const requireScope = (task, expected) => {
    if (expected && (task.company_id !== expected.companyId || task.run_id !== expected.runId)) {
      refuse('FORBIDDEN')
    }
  }
  const resumeDrained = async (accountId, taskId, runId) => {
    const key = JSON.stringify([accountId, taskId, runId])
    const flight = flights.get(key)
    if (!flight?.deliveryDrained) {
      return
    }
    await Promise.allSettled([flight.ready, flight.promise])
    if (flights.get(key) === flight) {
      flights.delete(key)
    }
  }
  const lifecycle = createExternalExecutionLifecycle({
    persistIntent: (run, intent) =>
      repository[intent.kind](run.accountId, run.taskId, run.id, scopeFor(run)),
    onUnavailable(run) {
      run.unavailable = true
    },
    port: {
      async recover(run) {
        if (run.explicitRecovery) {
          await resumeDrained(run.accountId, run.taskId, run.id)
        }
        await reserve(run.accountId, run.taskId, run.id, true, scopeFor(run))
      },
      async cancel(run) {
        await resumeDrained(run.accountId, run.taskId, run.id)
        const flight = flights.get(JSON.stringify([run.accountId, run.taskId, run.id]))
        if (flight) {
          flight.abort.abort()
        } else {
          await reserve(run.accountId, run.taskId, run.id, true, scopeFor(run))
        }
      },
      async drain(run) {
        const key = JSON.stringify([run.accountId, run.taskId, run.id])
        let flight = flights.get(key)
        if (!flight) {
          if (flights.size >= 32) {
            refuse('CAPACITY_EXCEEDED')
          }
          flight = {
            accountId: run.accountId,
            taskId: run.taskId,
            runId: run.id,
            abort: new AbortController(),
            ready: Promise.resolve(),
            promise: null,
            delivery: null
          }
          flights.set(key, flight)
        }
        // Keep the bounded delivery entry until explicit recovery; this is not a process stop.
        flight.deliveryDrained = true
        await flight.delivery?.close()
      }
    }
  })
  const retain = async (
    accountId,
    taskId,
    runId,
    action,
    reason = 'delivery_shutdown',
    expected,
    explicitRecovery = false
  ) => {
    const task = await repository.read(accountId, taskId, runId)
    requireScope(task, expected)
    const run = { ...externalRun(accountId, task), explicitRecovery }
    if (!(await lifecycle[action](run, reason))) {
      refuse('FORBIDDEN')
    }
    if (run.unavailable) {
      refuse('SERVICE_UNAVAILABLE')
    }
  }
  return { externalRun, requireScope, lifecycle, retain }
}
