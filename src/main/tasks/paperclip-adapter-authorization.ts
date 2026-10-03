import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { requirePaperclipTaskBinding } from './paperclip-adapter-binding'
import type {
  HiveRuntimeAdapterPorts,
  HiveRuntimeBinding,
  PaperclipTaskExecutionContext
} from './paperclip-adapter-contract'
import { TaskExecutionError } from './task-execution-error'

const RENEWAL_LEAD_MS = 10_000
// Only compares immutable requirements; this local comparison does not authorize an operation.
const COMPARISON_CALLER = 'adapter:authorization-comparison'

/** Renew the grant of one execution, never adopt a new binding or dispatch another start. */
export function createPaperclipTaskAuthorization(
  context: PaperclipTaskExecutionContext,
  ports: HiveRuntimeAdapterPorts,
  initial: HiveRuntimeBinding
) {
  let binding = initial
  let renewAt = Date.parse(initial.command.expiresAt) - RENEWAL_LEAD_MS
  let flight: Promise<HiveRuntimeBinding> | null = null
  return async () => {
    if (flight) {
      return flight
    }
    if (Date.now() < renewAt) {
      return binding
    }
    flight = requirePaperclipTaskBinding(context, ports)
      .then((next) => {
        if (
          next.bindingRef !== initial.bindingRef ||
          next.commandFingerprint !== initial.commandFingerprint ||
          computeTaskExecutionFingerprint(next.command, COMPARISON_CALLER) !==
            computeTaskExecutionFingerprint(initial.command, COMPARISON_CALLER)
        ) {
          throw new TaskExecutionError('IDEMPOTENCY_CONFLICT')
        }
        const expiresAt = Date.parse(next.command.expiresAt)
        if (expiresAt <= Date.now()) {
          throw new TaskExecutionError('FORBIDDEN')
        }
        // A resolver may still return the current committed grant before the issuer renews it.
        // Retry at expiry rather than resolving the same binding on every poll.
        renewAt =
          expiresAt === Date.parse(binding.command.expiresAt) ||
          expiresAt - RENEWAL_LEAD_MS <= Date.now()
            ? expiresAt
            : expiresAt - RENEWAL_LEAD_MS
        binding = next
        return binding
      })
      .finally(() => {
        flight = null
      })
    return flight
  }
}
