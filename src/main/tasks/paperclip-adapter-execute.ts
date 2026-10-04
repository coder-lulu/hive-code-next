import { setTimeout as delay } from 'node:timers/promises'
import { taskExecutionCapabilityRefusal } from '../../shared/task-execution/task-execution-capabilities'
import type { TaskExecutionObservation } from '../../shared/task-execution/task-execution-observation'
import { requirePaperclipTaskBinding } from './paperclip-adapter-binding'
import { createPaperclipTaskAuthorization } from './paperclip-adapter-authorization'
import type {
  HiveRuntimeAdapterPorts,
  HiveRuntimeBinding,
  HiveRuntimeBindingPurpose,
  PaperclipTaskExecutionContext,
  PaperclipTaskExecutionResult
} from './paperclip-adapter-contract'
import { paperclipTaskErrorResult, paperclipTaskTerminalResult } from './paperclip-adapter-result'
import { TaskExecutionError } from './task-execution-error'

/** Acceptance does not end a Paperclip run. Cancellation also waits for the host's terminal proof. */
export async function executePaperclipTask(
  context: PaperclipTaskExecutionContext,
  ports: HiveRuntimeAdapterPorts,
  purpose: HiveRuntimeBindingPurpose
): Promise<PaperclipTaskExecutionResult> {
  let binding: HiveRuntimeBinding | null = null
  let dispatched = purpose === 'recover'
  let startSettled = purpose === 'recover'
  const cancellation: { flight: Promise<TaskExecutionObservation | null> | null } = { flight: null }
  let cancelFailed = false
  let query: Record<string, unknown> | null = null
  let currentAuthorization: (() => Promise<HiveRuntimeBinding>) | null = null
  let cursor = ports.observationCursor ?? 0
  const refreshQuery = async () => {
    ports.assertCurrent?.()
    binding = await currentAuthorization!()
    ports.assertCurrent?.()
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
  const readObservation = async () => {
    await refreshQuery()
    // Runtime owns collection; a recovered dispatcher only reads the committed event stream.
    if (purpose === 'execute') {
      await ports.client.reconcile(query)
    }
    let observation: TaskExecutionObservation
    do {
      await refreshQuery()
      observation = await ports.client.observe({
        ...query,
        kind: 'execution.observe',
        afterSequence: cursor,
        limit: 32
      })
      ports.assertCurrent?.()
      await ports.onObservation?.(observation)
      cursor = observation.cursor
    } while (observation.result && cursor < observation.lastSequence)
    return observation
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
    ports.assertCurrent?.()
    binding = await requirePaperclipTaskBinding(context, ports, purpose)
    currentAuthorization = createPaperclipTaskAuthorization(context, ports, binding, purpose)
    await refreshQuery()
    context.signal!.addEventListener('abort', onAbort)
    await context.onCancellationReady!()
    if (
      purpose === 'execute' &&
      taskExecutionCapabilityRefusal(binding.command, await ports.client.capabilities())
    ) {
      throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
    }
    await refreshQuery()
    if (purpose === 'execute' && !context.signal!.aborted) {
      await context.onDispatch!()
      ports.assertCurrent?.()
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
        await requestCancellation()
        if (cancelFailed) {
          return paperclipTaskErrorResult('OUTCOME_UNKNOWN', binding, true)
        }
      }
      const observation = await readObservation()
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
    if (purpose === 'recover') {
      return paperclipTaskErrorResult('OUTCOME_UNKNOWN', binding, true, true)
    }
    const cancelled = await requestCancellation('shutdown')
    const observation = cancelled?.result ? await readObservation() : null
    return observation?.result
      ? {
          ...paperclipTaskTerminalResult(binding, observation),
          timedOut: observation.result.status === 'cancelled'
        }
      : paperclipTaskErrorResult('OUTCOME_UNKNOWN', binding, true, true)
  } catch (error) {
    if (dispatched && binding && query) {
      const observation = await readObservation().catch(() => null)
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
