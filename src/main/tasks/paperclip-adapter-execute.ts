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
import { TASK_EXECUTION_TIMEOUT_MS, taskExecutionDeadline } from './task-execution-budget'

/** Acceptance does not end a Paperclip run. Cancellation also waits for the host's terminal proof. */
export async function executePaperclipTask(
  context: PaperclipTaskExecutionContext,
  ports: HiveRuntimeAdapterPorts,
  purpose: HiveRuntimeBindingPurpose
): Promise<PaperclipTaskExecutionResult> {
  let binding: HiveRuntimeBinding | null = null
  let dispatched = purpose === 'recover'
  let startSettled = purpose === 'recover'
  let pendingStart = false
  let finishCancelledStart: (() => void) | null = null
  let timedOut = false
  const startedAt = Date.now()
  const executionDeadline = startedAt + TASK_EXECUTION_TIMEOUT_MS
  let deadline = Math.min(
    executionDeadline,
    startedAt + (ports.waitTimeoutMs ?? TASK_EXECUTION_TIMEOUT_MS)
  )
  const cancellation: { flight: Promise<TaskExecutionObservation | null> | null } = { flight: null }
  let cancelFailed = false
  let query: Record<string, unknown> | null = null
  let currentAuthorization: (() => Promise<HiveRuntimeBinding>) | null = null
  let cursor = ports.observationCursor ?? 0
  const refreshQuery = async (signal?: AbortSignal) => {
    ports.assertCurrent?.()
    if (!currentAuthorization) {
      throw new TaskExecutionError('SERVICE_UNAVAILABLE')
    }
    const next = await currentAuthorization()
    if (signal?.aborted) {
      return
    }
    ports.assertCurrent?.()
    binding = next
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
  const readObservation = async (renew = true) => {
    if (renew) {
      await refreshQuery()
    }
    ports.assertCurrent?.()
    // Runtime owns collection; a recovered dispatcher only reads the committed event stream.
    if (purpose === 'execute') {
      await ports.client.reconcile(query)
    }
    let observation: TaskExecutionObservation
    do {
      if (renew) {
        await refreshQuery()
      }
      observation = await ports.client.observe({
        ...query,
        kind: 'execution.observe',
        afterSequence: cursor,
        limit: 32
      })
      ports.assertCurrent?.()
      await ports.onObservation?.(observation)
      cursor = observation.cursor
      if (ports.waitTimeoutMs === undefined) {
        deadline = Math.min(deadline, taskExecutionDeadline(observation))
      }
    } while (observation.result && cursor < observation.lastSequence)
    return observation
  }
  const requestCancellation = (
    reason: 'user_requested' | 'shutdown' = 'user_requested',
    renew = true
  ) => {
    if (!cancellation.flight && binding && query) {
      cancellation.flight = (async () => {
        if (renew) {
          await refreshQuery()
        }
        ports.assertCurrent?.()
        const current = binding
        if (!current || !query) {
          throw new TaskExecutionError('SERVICE_UNAVAILABLE')
        }
        return ports.client.cancel({
          ...query,
          kind: 'execution.cancel',
          task: current.command.task,
          idempotencyKey: `cancel:${current.commandFingerprint}`,
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
    if (pendingStart) {
      const flight = requestCancellation('user_requested', false)
      if (flight) {
        void flight.then(() => finishCancelledStart?.())
      } else {
        finishCancelledStart?.()
      }
    } else if (startSettled) {
      void requestCancellation()
    }
  }
  const waitForStart = async (current: HiveRuntimeBinding) => {
    const polling = new AbortController()
    // A zero observation window still waits for admission within the fixed execution ceiling.
    const startDeadline = ports.waitTimeoutMs === 0 ? executionDeadline : deadline
    let settled = false
    pendingStart = true
    const cancelled = new Promise<void>((resolve) => {
      finishCancelledStart = resolve
    })
    const started = ports.client.start(current.command, current.commandFingerprint).finally(() => {
      settled = true
    })
    const renewal = (async () => {
      while (!settled && !polling.signal.aborted) {
        if (context.signal?.aborted) {
          await requestCancellation()
          return
        }
        await delay(ports.pollIntervalMs ?? 500, undefined, { signal: polling.signal })
        if (!settled && !polling.signal.aborted) {
          if (Date.now() >= startDeadline) {
            timedOut = true
            throw new TaskExecutionError('SERVICE_UNAVAILABLE')
          }
          await refreshQuery(polling.signal)
        }
      }
    })()
    const budget = delay(Math.max(0, startDeadline - Date.now()), undefined, {
      signal: polling.signal
    }).then(() => {
      timedOut = true
      throw new TaskExecutionError('SERVICE_UNAVAILABLE')
    })
    try {
      await Promise.race([started, renewal, budget, cancelled])
    } finally {
      pendingStart = false
      finishCancelledStart = null
      polling.abort()
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
          await waitForStart(binding)
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
    let lastStatus = ''
    while (Date.now() < deadline) {
      if (context.signal!.aborted) {
        await requestCancellation()
        if (cancelFailed) {
          return paperclipTaskErrorResult('OUTCOME_UNKNOWN', binding, true)
        }
      }
      const observation = await readObservation(!context.signal?.aborted)
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
      await requestCancellation('shutdown', false)
      const observation = await readObservation(false).catch(() => null)
      if (observation?.result) {
        return {
          ...paperclipTaskTerminalResult(binding, observation),
          timedOut: timedOut && observation.result.status === 'cancelled'
        }
      }
    }
    return paperclipTaskErrorResult(
      error instanceof TaskExecutionError ? error.code : 'SERVICE_UNAVAILABLE',
      binding,
      dispatched,
      timedOut
    )
  } finally {
    context.signal?.removeEventListener('abort', onAbort)
    if (cancellation.flight) {
      await cancellation.flight
    }
  }
}
