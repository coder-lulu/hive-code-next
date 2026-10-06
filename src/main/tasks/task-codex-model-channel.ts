import { getCodexBackendAuthHeaders } from '../rate-limits/codex-backend-auth'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import {
  TaskStructuredBindingSchema,
  type TaskStructuredBinding
} from '../../shared/task-execution/task-structured-binding'
import type { TaskCodexAccountScope } from './task-codex-account-scope'
import { createTaskModelBroker } from './task-model-broker'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { isDeepStrictEqual as same } from 'node:util'
import { refuseTaskExecution } from './task-execution-error'

export function createTaskCodexModelChannel(options: {
  store: AgentSessionRecordStore
  binding: TaskStructuredBinding
  account: TaskCodexAccountScope
  deadline: number
  assertCurrent: () => void
  readAuth?: typeof getCodexBackendAuthHeaders
  request?: typeof fetch
}) {
  const binding = TaskStructuredBindingSchema.parse(options.binding)
  const original = options.store.tasks.get(binding.source)
  if (!original || !same(original.structuredBinding, binding)) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  const assertEffectCurrent = (signal: AbortSignal | null | undefined) => {
    if (signal?.aborted) {
      throw new Error('TASK_MODEL_REQUEST_ABORTED')
    }
    assertTaskAuthorizationCurrent(() => options.assertCurrent())
    assertTaskAuthorizationCurrent(() => options.account.assertCurrent())
  }
  async function effect<T>(
    signal: AbortSignal | null | undefined,
    start: () => Promise<T>,
    discard?: (value: T) => void
  ): Promise<T> {
    let pending: Promise<T> | undefined
    try {
      const admitted = await options.store.tasks.runModelEffect(
        binding,
        () => assertEffectCurrent(signal),
        () => {
          assertEffectCurrent(signal)
          pending = start()
          // A quick rejection can precede file-lock release; observe it in the initiation frame.
          void pending.then(
            (value) => {
              if (signal?.aborted) {
                discard?.(value)
              }
            },
            () => undefined
          )
          return pending
        }
      )
      const value = await admitted.value
      assertEffectCurrent(signal)
      return value
    } catch (error) {
      // The actual fetch can outlive the transaction/channel which awaited it.
      if (pending && discard) {
        void pending.then(discard, () => undefined)
      }
      throw error
    }
  }
  return createTaskModelBroker({
    profile: taskDockerModelProfile(),
    authScope: {
      codexHome: options.account.codexHome,
      providerAccountId: options.account.providerAccountId,
      sessionId: binding.sessionId
    },
    deadline: options.deadline,
    assertCurrent: options.assertCurrent,
    reserveDispatch: async () => {
      assertTaskAuthorizationCurrent(() => options.account.assertCurrent())
      await options.store.tasks.reserveModelDispatch(binding, Date.now(), () => {
        assertTaskAuthorizationCurrent(() => options.assertCurrent())
        assertTaskAuthorizationCurrent(() => options.account.assertCurrent())
      })
    },
    readAuth: (target, signal) =>
      effect(signal, () => (options.readAuth ?? getCodexBackendAuthHeaders)(target, signal)),
    request: (input, init) =>
      effect(init?.signal, () => (options.request ?? fetch)(input, init), discardResponse),
    recordFailure: (failure) =>
      options.store.tasks.recordModelFailure(original, failure, Date.now())
  })
}

function discardResponse(response: Response) {
  try {
    void response.body?.cancel().catch(() => undefined)
  } catch {
    /* Disposal grants neither another dispatch nor remote consumption proof. */
  }
}
