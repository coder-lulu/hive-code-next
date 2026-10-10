import { randomUUID } from 'node:crypto'
import { isExternalExecutionRun } from '@hive-paperclip-external-execution'
import { createLocalTaskAdapterClient } from '../../../src/main/tasks/paperclip-runtime-adapter.ts'
import {
  createTaskDispatchDelivery,
  requireTaskDispatchBinding,
  taskDeliveryHeaders
} from './task-dispatch-delivery.mjs'
import { refuseTaskRepository as refuse } from './task-delivery-repository.mjs'
import { createTaskDispatchRecovery } from './task-dispatch-recovery.mjs'
import { createTaskDispatchControl } from './task-dispatch-control.mjs'
import { HiveWorkflowCaseRunReadSchema } from '../../../src/shared/hive-workflow-case-runs.ts'
import { HiveWorkflowPlanRunReadSchema } from '../../../src/shared/hive-workflow-plan-runs.ts'

/** Durable claims own delivery, while the Runtime retains the original process and workspace claim. */
export function createTaskDispatch(repository, options = {}) {
  const createClient = options.createClient ?? createLocalTaskAdapterClient
  const ownerId = `gateway:${randomUUID()}`
  const flights = new Map()
  let closed = false,
    closing
  const { externalRun, requireScope, lifecycle, retain } = createTaskDispatchControl({
    repository,
    flights,
    reserve: (...args) => reserve(...args)
  })
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
      let task = await repository.read(accountId, taskId, runId)
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
      const bridge = await createClient()
      const owner = await bridge.owner()
      if (owner.accountId !== accountId) {
        refuse('FORBIDDEN')
      }
      if (!task.binding) {
        const plan = task.run_scope?.kind === 'workbenchPlan'
        if (
          (recoveryOnly && !(plan && task.cancel_requested)) ||
          !['workbenchCase', 'workbenchPlan'].includes(task.run_scope?.kind) ||
          task.run_status !== 'queued' ||
          (task.cancel_requested && !plan) ||
          task.execution_stage === 'outcome_unknown' ||
          flight.abort.signal.aborted
        ) {
          refuse('REVISION_CONFLICT')
        }
        const refs = (plan ? HiveWorkflowPlanRunReadSchema : HiveWorkflowCaseRunReadSchema).parse({
          projectId: task.run_scope.projectId,
          caseId: task.run_scope.caseId,
          taskId: task.id,
          runId: task.run_id,
          ...(plan ? { applicationRef: task.run_scope.applicationRef } : {})
        })
        await (plan ? bridge.preparePlanRun(refs) : bridge.prepareCaseRun(refs))
        const current = await bridge.owner()
        if (
          current.accountId !== owner.accountId ||
          current.runtimeRecordId !== owner.runtimeRecordId ||
          current.ownershipEpoch !== owner.ownershipEpoch
        ) {
          refuse('FORBIDDEN')
        }
        task = await repository.read(accountId, taskId, runId)
        requireScope(task, expected)
      }
      if (!task.binding) {
        refuse('REVISION_CONFLICT')
      }
      if (!isExternalExecutionRun(externalRun(accountId, task))) {
        refuse('FORBIDDEN')
      }
      if (owner.runtimeRecordId !== task.binding.command.runtimeRecordId) {
        refuse('FORBIDDEN')
      }
      if (task.result_receipt) {
        forget()
        return
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
      if (!recovering && ['workbenchCase', 'workbenchPlan'].includes(task.run_scope.kind)) {
        requireTaskDispatchBinding(
          task,
          await bridge.binding(task.company_id, task.run_id, 'execute')
        )
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
    start: (account, id, runId) => reserve(account, id, runId),
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
