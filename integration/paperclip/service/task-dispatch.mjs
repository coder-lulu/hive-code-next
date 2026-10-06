import { randomUUID } from 'node:crypto'
import {
  createExternalExecutionLifecycle,
  isExternalExecutionRun
} from '@hive-paperclip-external-execution'
import { createLocalTaskAdapterClient } from '../../../src/main/tasks/paperclip-runtime-adapter.ts'
import {
  createTaskDispatchDelivery,
  requireTaskDispatchBinding,
  taskDeliveryHeaders
} from './task-dispatch-delivery.mjs'
import { refuseTaskRepository as refuse } from './task-delivery-repository.mjs'
import { createTaskDispatchRecovery } from './task-dispatch-recovery.mjs'

/** Durable claims own delivery, while the Runtime retains the original process and workspace claim. */
export function createTaskDispatch(repository, options = {}) {
  const createClient = options.createClient ?? createLocalTaskAdapterClient
  const ownerId = `gateway:${randomUUID()}`
  const flights = new Map()
  let closed = false,
    closing
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
  const reserve = (accountId, taskId, runId, recoveryOnly = false, expected) => {
    if (closed) {
      return Promise.reject(
        Object.assign(new Error('SERVICE_UNAVAILABLE'), { code: 'SERVICE_UNAVAILABLE' })
      )
    }
    const key = JSON.stringify([accountId, taskId, runId])
    if (flights.has(key)) {
      return flights.get(key).ready
    }
    if (flights.size >= 32) {
      return Promise.reject(
        Object.assign(new Error('CAPACITY_EXCEEDED'), { code: 'CAPACITY_EXCEEDED' })
      )
    }
    const flight = {
      accountId,
      taskId,
      runId,
      abort: new AbortController(),
      ready: null,
      promise: null,
      delivery: null,
      deliveryDrained: false
    }
    flights.set(key, flight)
    const forget = () => {
      if (flights.get(key) === flight && !flight.deliveryDrained) {
        flights.delete(key)
      }
    }
    flight.ready = (async () => {
      const task = await repository.read(accountId, taskId, runId)
      requireScope(task, expected)
      if (task.result_receipt) {
        forget()
        return
      }
      if (closed || flight.deliveryDrained) {
        await lifecycle.drain(externalRun(accountId, task), 'delivery_shutdown')
        forget()
        return
      }
      if (!task.binding) {
        refuse('REVISION_CONFLICT')
      }
      if (!isExternalExecutionRun(externalRun(accountId, task))) {
        refuse('FORBIDDEN')
      }
      const bridge = await createClient()
      const owner = await bridge.owner()
      if (
        owner.accountId !== accountId ||
        owner.runtimeRecordId !== task.binding.command.runtimeRecordId
      ) {
        refuse('FORBIDDEN')
      }
      const previous = await repository.getCurrentDelivery(accountId, task.company_id, task.run_id)
      if (recoveryOnly && !previous && task.run_status === 'queued' && !task.cancel_requested) {
        forget()
        return
      }
      const recovering =
        recoveryOnly ||
        previous !== null ||
        task.run_status !== 'queued' ||
        task.cancel_requested ||
        flight.abort.signal.aborted
      if (
        previous &&
        previous.ownerId !== ownerId &&
        !task.cancel_requested &&
        Date.parse(previous.expiresAt) > Date.parse(previous.serverNow)
      ) {
        refuse('OUTCOME_UNKNOWN')
      }
      if (recovering) {
        // A Runtime handshake, not caller-supplied JSON, revokes the previous start nonce before CAS.
        requireTaskDispatchBinding(
          task,
          await bridge.binding(task.company_id, task.run_id, 'recover')
        )
      } else if (owner.ownershipEpoch !== task.binding.command.ownershipEpoch) {
        refuse('FORBIDDEN')
      }
      if (closed || flight.deliveryDrained) {
        await lifecycle.drain(externalRun(accountId, task), 'delivery_shutdown')
        forget()
        return
      }
      const requestedAt = performance.now()
      const claim = {
        ownerId,
        leaseRef: `delivery:${randomUUID()}`,
        expectedGeneration: previous?.generation ?? 0,
        leaseMs: 30_000
      }
      const proof = recovering
        ? await repository.claimRecoveryDelivery(accountId, taskId, runId, {
            ...claim,
            commandFingerprint: task.binding.commandFingerprint
          })
        : await repository.claimDelivery(accountId, taskId, runId, claim)
      const token = {
        ownerId: proof.ownerId,
        leaseRef: proof.leaseRef,
        generation: proof.generation
      }
      const client = await createClient(taskDeliveryHeaders(token))
      flight.delivery = createTaskDispatchDelivery({
        repository,
        accountId,
        task,
        proof,
        client,
        abort: flight.abort,
        requestedAt,
        purpose: recovering ? 'recover' : 'execute',
        createAdapter: options.createAdapter
      })
      try {
        if (closed || flight.deliveryDrained) {
          await lifecycle.drain(externalRun(accountId, task), 'delivery_shutdown')
          await flight.delivery.close()
          forget()
          return
        }
        if (!recovering) {
          await repository.claimDispatch(accountId, taskId, runId, token)
        }
        if (closed || flight.deliveryDrained) {
          await lifecycle.drain(externalRun(accountId, task), 'delivery_shutdown')
          await flight.delivery.close()
          forget()
          return
        }
      } catch (error) {
        await flight.delivery.close()
        throw error
      }
      flight.promise = (async () => {
        try {
          await flight.delivery.run()
          if (!(await repository.read(accountId, taskId, runId)).result_receipt) {
            await repository.unknown(accountId, taskId, runId, token)
          }
        } catch {
          await repository.unknown(accountId, taskId, runId, token).catch(() => {})
        } finally {
          await flight.delivery.close()
          forget()
        }
      })()
      void flight.promise.catch(() => {})
    })().catch((error) => {
      forget()
      throw error
    })
    return flight.ready
  }
  const recovery = createTaskDispatchRecovery({
    repository,
    createClient,
    recover: (account, id, runId) => retain(account, id, runId, 'recover'),
    isClosed: () => closed
  })
  return {
    start: (accountId, taskId, runId) => reserve(accountId, taskId, runId),
    recover: recovery.check,
    startRecovery: recovery.start,
    async control(accountId, taskId, action, expected) {
      if (
        !['recover', 'cancel', 'drain'].includes(action) ||
        !expected?.companyId ||
        !expected?.runId
      ) {
        refuse('FORBIDDEN')
      }
      await retain(
        accountId,
        taskId,
        expected.runId,
        action,
        'core_control',
        expected,
        action === 'recover'
      )
    },
    async cancel(accountId, taskId, runId) {
      await retain(accountId, taskId, runId, 'cancel', 'user_requested')
    },
    close() {
      if (closing) {
        return closing
      }
      closed = true
      const current = [...flights.values()]
      return (closing = (async () => {
        await recovery.close()
        const results = await Promise.allSettled(
          current.map(async (flight) => {
            try {
              await retain(flight.accountId, flight.taskId, flight.runId, 'drain')
            } finally {
              await flight.delivery?.close()
              await flight.ready
              await flight.delivery?.close()
              await flight.promise
            }
          })
        )
        if (results.some((result) => result.status === 'rejected')) {
          throw Object.assign(new Error('SERVICE_UNAVAILABLE'), { code: 'SERVICE_UNAVAILABLE' })
        }
      })())
    }
  }
}
