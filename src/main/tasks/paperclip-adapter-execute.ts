import { setTimeout as delay } from 'node:timers/promises'
import { taskExecutionCapabilityRefusal } from '../../shared/task-execution/task-execution-capabilities'
import type { TaskExecutionObservation } from '../../shared/task-execution/task-execution-observation'
import { requirePaperclipTaskBinding } from './paperclip-adapter-binding'
import { createPaperclipTaskAuthorization } from './paperclip-adapter-authorization'
import type {
  HiveRuntimeAdapterPorts,
  HiveRuntimeBinding,
  PaperclipTaskExecutionContext,
  PaperclipTaskExecutionResult
} from './paperclip-adapter-contract'
import { paperclipTaskErrorResult, paperclipTaskTerminalResult } from './paperclip-adapter-result'
import { TaskExecutionError } from './task-execution-error'

/** Acceptance does not end a Paperclip run. Cancellation also waits for the host's terminal proof. */
export async function executePaperclipTask(
  context: PaperclipTaskExecutionContext,
  ports: HiveRuntimeAdapterPorts
): Promise<PaperclipTaskExecutionResult> {
  let binding: HiveRuntimeBinding | null = null
  let dispatched = false
  let startSettled = false
  const cancellation: { flight: Promise<TaskExecutionObservation | null> | null } = { flight: null }
  let cancelFailed = false
  let query: Record<string, unknown> | null = null
  let currentAuthorization: (() => Promise<HiveRuntimeBinding>) | null = null
  const refreshQuery = async () => {
    binding = await currentAuthorization!()
    query = {
      protocolVersion: binding.command.protocolVersion,
      runtimeRecordId: binding.command.runtimeRecordId,
      ownershipEpoch: binding.command.ownershipEpoch,
      executionId: binding.command.executionId,
      executionEpoch: binding.command.executionEpoch,
      commandFingerprint: binding.commandFingerprint,
      authorizationRef: binding.command.authorizationRef,
      authorizationRevision: binding.command.authorizationRevision,
      expiresAt: binding.command.expiresAt,
      kind: 'execution.reconcile'
    }
  }
  const requestCancellation = (reason: 'user_requested' | 'shutdown' = 'user_requested') => {
    if (!cancellation.flight && binding && query) {
      cancellation.flight = (async () => {
        await refreshQuery()
        return ports.client.cancel({
          ...query,
          kind: 'execution.cancel',
          task: binding!.command.task,
          idempotencyKey: `cancel:${binding!.commandFingerprint}`,
          reason
        })
      })().catch(() => {
        cancelFailed = true
        return null
      })
    }
    return cancellation.flight
  }
  const onAbort = () => {
    if (startSettled) {
      void requestCancellation()
    }
  }
  try {
    binding = await requirePaperclipTaskBinding(context, ports)
    currentAuthorization = createPaperclipTaskAuthorization(context, ports, binding)
    await refreshQuery()
    context.signal!.addEventListener('abort', onAbort)
    await context.onCancellationReady!()
    if (taskExecutionCapabilityRefusal(binding.command, await ports.client.capabilities())) {
      throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
    }
    await refreshQuery()
    if (!context.signal!.aborted) {
      context.onDispatch!()
      dispatched = true
      try {
        if (!context.signal!.aborted) {
          await ports.client.start(binding.command, binding.commandFingerprint)
        }
      } finally {
        startSettled = true
        if (context.signal!.aborted) {
          void requestCancellation()
        }
      }
    } else {
      startSettled = true
    }
    const deadline = Date.now() + (ports.waitTimeoutMs ?? 30 * 60_000)
    let lastStatus = ''
    while (Date.now() < deadline) {
      if (context.signal!.aborted) {
        const cancelled = await requestCancellation()
        if (cancelled?.result) {
          return paperclipTaskTerminalResult(binding, cancelled)
        }
        if (cancelFailed) {
          return paperclipTaskErrorResult('OUTCOME_UNKNOWN', binding, true)
        }
      }
      await refreshQuery()
      const observation = await ports.client.reconcile(query)
      if (observation.result) {
        return paperclipTaskTerminalResult(binding, observation)
      }
      if (lastStatus !== observation.status) {
        await context.onLog(
          'stdout',
          `[hive_runtime] ${binding.command.executionId} ${observation.status}\n`
        )
        lastStatus = observation.status
      }
      await delay(
        ports.pollIntervalMs ?? 500,
        undefined,
        context.signal!.aborted ? undefined : { signal: context.signal }
      ).catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          throw error
        }
      })
    }
    const cancelled = await requestCancellation('shutdown')
    return cancelled?.result
      ? {
          ...paperclipTaskTerminalResult(binding, cancelled),
          timedOut: cancelled.result.status === 'cancelled'
        }
      : paperclipTaskErrorResult('OUTCOME_UNKNOWN', binding, true, true)
  } catch (error) {
    if (dispatched && binding && query) {
      const observation = await refreshQuery()
        .then(() => ports.client.reconcile(query))
        .catch(() => null)
      if (observation?.result) {
        return paperclipTaskTerminalResult(binding, observation)
      }
    }
    return paperclipTaskErrorResult(
      error instanceof TaskExecutionError ? error.code : 'SERVICE_UNAVAILABLE',
      binding,
      dispatched
    )
  } finally {
    context.signal?.removeEventListener('abort', onAbort)
    if (cancellation.flight) {
      await cancellation.flight
    }
  }
}
