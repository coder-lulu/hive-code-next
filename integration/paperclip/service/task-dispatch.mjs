import { createServerAdapter } from '../../../src/main/tasks/paperclip-runtime-adapter.ts'
import { LocalTaskClient } from '../../../src/main/tasks/local-task-client.ts'
import { readFile } from 'node:fs/promises'

/** The sole adapter runs outside Paperclip's Provider/workspace/secret preparation pipeline. */
export function createTaskDispatch(repository) {
  const flights = new Map()
  let closed = false
  let closing
  return {
    start(accountId, taskId) {
      if (closed) {
        return Promise.reject(
          Object.assign(new Error('SERVICE_UNAVAILABLE'), { code: 'SERVICE_UNAVAILABLE' })
        )
      }
      const key = JSON.stringify([accountId, taskId])
      if (flights.has(key)) {
        return flights.get(key).ready
      }
      const abort = new AbortController()
      const flight = { abort, promise: null, ready: null }
      flights.set(key, flight)
      flight.ready = repository
        .claimDispatch(accountId, taskId)
        .then((task) => {
          if (task.result_receipt) {
            flights.delete(key)
            return
          }
          flight.promise = (async () => {
            const descriptor = JSON.parse(
              await readFile(process.env.HIVE_TASK_TRANSPORT_DESCRIPTOR, 'utf8')
            )
            const client = new LocalTaskClient(descriptor)
            const result = await createServerAdapter(() =>
              Promise.resolve({
                client,
                resolveBinding: (company, run) => client.binding(company, run)
              })
            ).execute({
              runId: task.run_id,
              agent: { id: task.agent_id, companyId: task.company_id, adapterType: 'hive_runtime' },
              config: {
                workspaceRef: task.binding.command.workspaceRef,
                profileId: task.binding.command.profileId,
                profileRevision: task.binding.command.profileRevision
              },
              runtime: { taskKey: task.id, sessionParams: null },
              signal: abort.signal,
              onCancellationReady: async () => {
                if ((await repository.read(accountId, taskId)).cancel_requested) {
                  abort.abort()
                }
              },
              onDispatch: () => {},
              onLog: async (_stream, text) => {
                if (
                  text === `[hive_runtime] ${task.binding.command.executionId} outcome_unknown\n`
                ) {
                  await repository.unknown(accountId, taskId)
                }
              }
            })
            if (!['succeeded', 'failed', 'cancelled'].includes(result.resultJson?.status)) {
              await repository.unknown(accountId, taskId)
              return
            }
            const binding = await client.binding(task.company_id, task.run_id)
            const command = binding.command
            const observation = await client.reconcile({
              protocolVersion: command.protocolVersion,
              runtimeRecordId: command.runtimeRecordId,
              ownershipEpoch: command.ownershipEpoch,
              executionId: command.executionId,
              executionEpoch: command.executionEpoch,
              kind: 'execution.reconcile',
              commandFingerprint: binding.commandFingerprint,
              authorizationRef: command.authorizationRef,
              authorizationRevision: command.authorizationRevision,
              expiresAt: command.expiresAt
            })
            await (observation.result
              ? repository.settle(accountId, taskId, observation.result)
              : repository.unknown(accountId, taskId))
          })()
            .catch(() => repository.unknown(accountId, taskId))
            .finally(() => flights.delete(key))
          void flight.promise.catch(() => {})
        })
        .catch((error) => {
          flights.delete(key)
          throw error
        })
      return flight.ready
    },
    cancel(accountId, taskId) {
      flights.get(JSON.stringify([accountId, taskId]))?.abort.abort()
    },
    close() {
      if (closing) {
        return closing
      }
      closed = true
      for (const flight of flights.values()) {
        flight.abort.abort()
      }
      // Do not convert a lost bridge/timeout into a cancelled business task.
      closing = Promise.allSettled(
        [...flights.values()].map(async (flight) => {
          await flight.ready
          await flight.promise
        })
      )
      return closing
    }
  }
}
