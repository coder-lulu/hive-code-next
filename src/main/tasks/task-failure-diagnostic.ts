import { AGENT_SESSION_WIRE_REFUSAL_CODES } from '../../shared/agent-session-wire-refusals'
import { TASK_EXECUTION_ERROR_CODES } from './task-execution-error'
import {
  isTaskResponseContentTypeKind,
  type TaskResponseContentTypeKind
} from './task-response-content-type'

const modelCodes = [
  'TASK_MODEL_ACCOUNT_BUSY',
  'TASK_MODEL_AUTH_SCOPE_UNAVAILABLE',
  'TASK_MODEL_AUTH_UNAVAILABLE',
  'TASK_MODEL_AUTHORITY_REVOKED',
  'TASK_MODEL_BUDGET_REFUSED',
  'TASK_MODEL_CHANNEL_UNAVAILABLE',
  'TASK_MODEL_DEADLINE_EXCEEDED',
  'TASK_MODEL_IDLE_TIMEOUT',
  'TASK_MODEL_LIMIT_UNAVAILABLE',
  'TASK_MODEL_POLICY_REFUSED',
  'TASK_MODEL_PROFILE_UNAVAILABLE',
  'TASK_MODEL_REQUEST_ABORTED',
  'TASK_MODEL_REQUEST_REFUSED',
  'TASK_MODEL_STREAM_REFUSED',
  'TASK_MODEL_UPSTREAM_UNAVAILABLE'
] as const
const phases = [
  'request',
  'authority',
  'reservation',
  'auth',
  'fetch',
  'response',
  'stream',
  'channel',
  'authorization_monitor'
] as const
type Phase = (typeof phases)[number]
type ModelCode = (typeof modelCodes)[number]
type Code =
  | ModelCode
  | (typeof TASK_EXECUTION_ERROR_CODES)[number]
  | (typeof AGENT_SESSION_WIRE_REFUSAL_CODES)[number]
const knownCodes: ReadonlySet<string> = new Set([
  ...modelCodes,
  ...TASK_EXECUTION_ERROR_CODES,
  ...AGENT_SESSION_WIRE_REFUSAL_CODES
])
const knownModelCodes: ReadonlySet<string> = new Set(modelCodes)
const networkCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
])
type Category =
  | 'authorization'
  | 'capacity'
  | 'timeout'
  | 'cancelled'
  | 'protocol'
  | 'http'
  | 'network'
  | 'unavailable'
  | 'unknown'
const responseReasons = ['content_type', 'content_encoding', 'missing_body'] as const
type ResponseReason = (typeof responseReasons)[number]
export type TaskFailureDiagnostic = Readonly<{
  phase: Phase
  category: Category
  code: Code
  causeCode?: Code
  httpStatus?: number
  networkCode?: string
  responseReason?: ResponseReason
  contentTypeKind?: TaskResponseContentTypeKind
}>
const trustedFailures = new WeakSet<TaskFailureError>()

function own(value: unknown, key: string): unknown {
  try {
    return typeof value === 'object' && value !== null
      ? Object.getOwnPropertyDescriptor(value, key)?.value
      : undefined
  } catch {
    return undefined
  }
}
function isCode(value: unknown): value is Code {
  return typeof value === 'string' && knownCodes.has(value)
}
function category(code: string, networkCode?: string, httpStatus?: number): Category {
  if (httpStatus !== undefined && httpStatus !== 200) {
    return 'http'
  }
  if (networkCode) {
    return 'network'
  }
  switch (code) {
    case 'FORBIDDEN':
    case 'TASK_MODEL_AUTH_UNAVAILABLE':
    case 'TASK_MODEL_AUTH_SCOPE_UNAVAILABLE':
    case 'TASK_MODEL_AUTHORITY_REVOKED':
      return 'authorization'
    case 'CAPACITY_EXCEEDED':
    case 'TASK_MODEL_ACCOUNT_BUSY':
    case 'TASK_MODEL_BUDGET_REFUSED':
    case 'TASK_MODEL_LIMIT_UNAVAILABLE':
      return 'capacity'
    case 'TASK_MODEL_DEADLINE_EXCEEDED':
    case 'TASK_MODEL_IDLE_TIMEOUT':
      return 'timeout'
    case 'TASK_MODEL_REQUEST_ABORTED':
      return 'cancelled'
    case 'TASK_MODEL_POLICY_REFUSED':
    case 'TASK_MODEL_REQUEST_REFUSED':
    case 'TASK_MODEL_STREAM_REFUSED':
      return 'protocol'
    case 'SERVICE_UNAVAILABLE':
    case 'TASK_MODEL_CHANNEL_UNAVAILABLE':
    case 'TASK_MODEL_PROFILE_UNAVAILABLE':
    case 'TASK_MODEL_UPSTREAM_UNAVAILABLE':
      return 'unavailable'
    default:
      return 'unknown'
  }
}

/** Only finite codes survive; error prose, headers, bodies and routing never enter this value. */
export class TaskFailureError extends Error {
  readonly diagnostic: TaskFailureDiagnostic

  constructor(
    error: unknown,
    phase: Phase,
    fallback: Code,
    httpStatus?: number,
    responseReason?: ResponseReason,
    contentTypeKind?: TaskResponseContentTypeKind
  ) {
    const safeFallback = isCode(fallback) ? fallback : 'OUTCOME_UNKNOWN'
    let code: Code = safeFallback
    let causeCode: Code | undefined
    let networkCode: string | undefined
    for (let depth = 0; depth < 5 && error; depth++) {
      const candidate = own(error, 'code'),
        message = own(error, 'message')
      const found = isCode(candidate) ? candidate : isCode(message) ? message : undefined
      if (found && !causeCode) {
        causeCode = found
      }
      if (typeof candidate === 'string' && networkCodes.has(candidate) && !networkCode) {
        networkCode = candidate
      }
      error = own(error, 'cause')
    }
    if (causeCode && (knownModelCodes.has(causeCode) || phase === 'authorization_monitor')) {
      code = causeCode
    } else if (phase === 'reservation' && causeCode === 'CAPACITY_EXCEEDED') {
      code = 'TASK_MODEL_BUDGET_REFUSED'
    }
    const status =
      typeof httpStatus === 'number' &&
      Number.isInteger(httpStatus) &&
      httpStatus >= 100 &&
      httpStatus <= 599
        ? httpStatus
        : undefined
    super(code)
    this.diagnostic = Object.freeze({
      phase: phases.includes(phase) ? phase : 'channel',
      category: category(causeCode ?? code, networkCode, status),
      code,
      ...(causeCode && causeCode !== code ? { causeCode } : {}),
      ...(status !== undefined ? { httpStatus: status } : {}),
      ...(networkCode ? { networkCode } : {}),
      ...(phase === 'response' &&
      code === 'TASK_MODEL_STREAM_REFUSED' &&
      status === 200 &&
      responseReason &&
      responseReasons.includes(responseReason)
        ? { responseReason }
        : {}),
      ...(phase === 'response' &&
      code === 'TASK_MODEL_STREAM_REFUSED' &&
      status === 200 &&
      responseReason === 'content_type' &&
      isTaskResponseContentTypeKind(contentTypeKind)
        ? { contentTypeKind }
        : {})
    })
    trustedFailures.add(this)
    this.stack = code
    Object.freeze(this)
  }
}

export function taskFailure(
  error: unknown,
  phase: Phase,
  fallback: Code,
  httpStatus?: number,
  responseReason?: ResponseReason,
  contentTypeKind?: TaskResponseContentTypeKind
): TaskFailureError {
  try {
    if (error instanceof TaskFailureError && trustedFailures.has(error)) {
      return error
    }
  } catch {
    /* Even a hostile prototype trap cannot prevent safe cleanup. */
  }
  return new TaskFailureError(error, phase, fallback, httpStatus, responseReason, contentTypeKind)
}
export function taskFailureSummary(
  source: 'model' | 'authorization',
  failure: TaskFailureError
): string {
  return `Task ${source} failure: ${JSON.stringify(taskFailure(failure, 'channel', 'OUTCOME_UNKNOWN').diagnostic)}`
}
export function hasTaskFailureSummary(
  events: readonly { summary?: string }[],
  source: 'model' | 'authorization'
): boolean {
  return events.some((event) => event.summary?.startsWith(`Task ${source} failure:`))
}
