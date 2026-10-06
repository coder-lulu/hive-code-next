import { createServerAdapter } from '../../../src/main/tasks/paperclip-runtime-adapter.ts'
import { HiveRuntimeAdapterBinding } from '../../../src/main/tasks/paperclip-adapter-contract.ts'
import { computeTaskExecutionFingerprint } from '../../../src/shared/task-execution/task-execution-fingerprint.ts'
import { TaskDeliveryProofSchema } from '../../../src/shared/task-execution/task-command-delivery.ts'
import { canonicalAgentSessionDigest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { refuseTaskRepository as refuse } from './task-delivery-repository.mjs'

export function requireTaskDispatchBinding(task, value) {
  const binding = HiveRuntimeAdapterBinding.parse(value)
  if (
    binding.paperclipCompanyId !== task.company_id ||
    binding.paperclipAgentId !== task.agent_id ||
    binding.command.task.taskId !== task.id ||
    binding.command.task.runId !== task.run_id ||
    binding.commandFingerprint !== task.binding.commandFingerprint ||
    computeTaskExecutionFingerprint(binding.command, 'adapter:delivery-comparison') !==
      computeTaskExecutionFingerprint(task.binding.command, 'adapter:delivery-comparison')
  ) {
    refuse('IDEMPOTENCY_CONFLICT')
  }
  return binding
}

export const taskDeliveryHeaders = (token) => ({
  'X-Hive-Delivery-Owner': token.ownerId,
  'X-Hive-Delivery-Lease': token.leaseRef,
  'X-Hive-Delivery-Generation': String(token.generation)
})

/** Lease loss ends observation authority; it never proves process death or requests cancellation. */
export function createTaskDispatchDelivery({
  repository,
  accountId,
  task,
  proof,
  client,
  abort,
  purpose,
  createAdapter = createServerAdapter,
  leaseMs = 30_000,
  monotonicNow = () => performance.now(),
  requestedAt = monotonicNow()
}) {
  const token = { ownerId: proof.ownerId, leaseRef: proof.leaseRef, generation: proof.generation }
  let deadline,
    timer,
    renewal,
    disposed = false,
    terminal = false,
    failure = null,
    closing
  let lastObservationHash = null,
    nextCancellationCheck = 0
  const acceptProof = (value, startedAt) => {
    const current = TaskDeliveryProofSchema.parse(value)
    if (
      current.accountId !== accountId ||
      current.companyId !== task.company_id ||
      current.taskId !== task.id ||
      current.runId !== task.run_id ||
      current.ownerId !== token.ownerId ||
      current.leaseRef !== token.leaseRef ||
      current.generation !== token.generation ||
      current.commandFingerprint !== task.binding.commandFingerprint ||
      [
        'protocolVersion',
        'runtimeRecordId',
        'ownershipEpoch',
        'executionId',
        'executionEpoch',
        'operationId',
        'workspaceExecutionClaimRef',
        'writeFence'
      ].some((key) => current[key] !== task.binding.command[key])
    ) {
      refuse('IDEMPOTENCY_CONFLICT')
    }
    const remaining = Date.parse(current.expiresAt) - Date.parse(current.serverNow)
    if (remaining <= 0 || remaining > 60_000) {
      refuse('OUTCOME_UNKNOWN')
    }
    deadline = startedAt + remaining
  }
  const assertCurrent = () => {
    if (disposed || failure || monotonicNow() >= deadline) {
      refuse('OUTCOME_UNKNOWN')
    }
  }
  acceptProof(proof, requestedAt)
  const checkCancellation = async () => {
    assertCurrent()
    if (monotonicNow() < nextCancellationCheck) {
      return
    }
    const current = await repository.read(accountId, task.id, task.run_id)
    assertCurrent()
    if (current.cancel_requested) {
      abort.abort()
    }
    nextCancellationCheck = monotonicNow() + 1000
  }
  const armRenewal = () => {
    if (disposed || terminal || failure) {
      return
    }
    timer = setTimeout(
      () => {
        renewal = (async () => {
          assertCurrent()
          const startedAt = monotonicNow()
          const current = await repository.renewDelivery(accountId, task.id, task.run_id, {
            ...token,
            leaseMs
          })
          if (disposed || terminal) {
            return
          }
          acceptProof(current, startedAt)
          assertCurrent()
          await checkCancellation()
        })()
          .catch((error) => {
            failure = error
          })
          .finally(() => {
            renewal = null
            armRenewal()
          })
      },
      Math.max(1, Math.min(leaseMs / 3, (deadline - monotonicNow()) / 3))
    )
    timer.unref?.()
  }
  armRenewal()
  return {
    token,
    async run() {
      assertCurrent()
      const adapter = createAdapter(async () => ({
        client,
        assertCurrent,
        observationCursor: proof.cursor,
        resolveBinding: async (company, run, intent) => {
          assertCurrent()
          const binding = await client.binding(company, run, intent)
          assertCurrent()
          return requireTaskDispatchBinding(task, binding)
        },
        onObservation: async (observation) => {
          assertCurrent()
          await checkCancellation()
          const hash = canonicalAgentSessionDigest(observation)
          if (hash !== lastObservationHash) {
            const consumed = await repository.consumeObservation(
              accountId,
              task.id,
              task.run_id,
              token,
              observation
            )
            terminal = consumed.settled
            lastObservationHash = hash
          }
        }
      }))
      return adapter[purpose]({
        runId: task.run_id,
        agent: { id: task.agent_id, companyId: task.company_id, adapterType: 'hive_runtime' },
        config: {
          workspaceRef: task.binding.command.workspaceRef,
          profileId: task.binding.command.profileId,
          profileRevision: task.binding.command.profileRevision
        },
        runtime: { taskKey: task.id, sessionParams: null },
        signal: abort.signal,
        onCancellationReady: checkCancellation,
        onDispatch: assertCurrent,
        onLog: async () => {
          await checkCancellation()
        }
      })
    },
    close() {
      return (closing ??= (async () => {
        disposed = true
        clearTimeout(timer)
        await renewal
        // Revoke cached start grants before shortening the DB lease; missing proof retains the horizon.
        try {
          requireTaskDispatchBinding(
            task,
            await client.binding(task.company_id, task.run_id, 'recover')
          )
          await repository.releaseDelivery(accountId, task.id, task.run_id, token)
        } catch {
          /* Another owner or an unavailable Runtime keeps recovery unresolved. */
        }
      })())
    }
  }
}
