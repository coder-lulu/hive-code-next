import { AGENT_SESSION_WIRE_REFUSAL_CODES } from '../../shared/agent-session-wire-refusals'
import { TASK_EXECUTION_ERROR_CODES } from './task-execution-error'

const codes = new Set<string>([
  ...AGENT_SESSION_WIRE_REFUSAL_CODES,
  ...TASK_EXECUTION_ERROR_CODES,
  'TASK_MODEL_AUTH_SCOPE_UNAVAILABLE',
  'agent_launch_required_mode_unavailable'
])

export function taskDispatchFailureSummary(error: unknown): string {
  const found: string[] = []
  for (let depth = 0; depth < 5 && error instanceof Error; depth++) {
    const code = 'code' in error ? error.code : undefined
    const candidate = typeof code === 'string' && codes.has(code) ? code : error.message
    if (codes.has(candidate) && !found.includes(candidate)) {
      found.push(candidate)
    }
    error = error.cause
  }
  return `Task dispatch: ${found.length ? found.join(' > ') : 'OUTCOME_UNKNOWN'}`
}
