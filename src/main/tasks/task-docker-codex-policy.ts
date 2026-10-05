import { posix } from 'node:path'

export const TASK_DOCKER_WORKSPACE = '/workspace'
export const TASK_DOCKER_CODEX_HOME = '/home/hive/.codex'
export const TASK_DOCKER_MODEL_PROVIDER = 'hive-loopback'
export const TASK_DOCKER_COMMAND_TIMEOUT_MS = 30_000
export const TASK_DOCKER_COMMAND_OUTPUT_BYTES = 1024 * 1024

const externalSandbox = { type: 'externalSandbox', networkAccess: 'restricted' }
const readMethods = new Set([
  'initialize',
  'initialized',
  'model/list',
  'config/read',
  'configRequirements/read',
  'thread/read',
  'thread/turns/list',
  'thread/unsubscribe',
  'turn/interrupt'
])
const threadKeys = new Set([
  'approvalPolicy',
  'baseInstructions',
  'cwd',
  'developerInstructions',
  'ephemeral',
  'excludeTurns',
  'model',
  'modelProvider',
  'personality',
  'sandbox',
  'serviceTier',
  'threadId',
  'path'
])
const turnKeys = new Set([
  'approvalPolicy',
  'clientUserMessageId',
  'cwd',
  'effort',
  'input',
  'model',
  'outputSchema',
  'personality',
  'sandboxPolicy',
  'serviceTier',
  'summary',
  'threadId'
])
const commandKeys = new Set(['command', 'cwd', 'outputBytesCap', 'sandboxPolicy', 'timeoutMs'])
const envelopeKeys = new Set(['id', 'method', 'params', 'jsonrpc'])

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function refuse(): never {
  throw new Error('TASK_DOCKER_POLICY_REFUSED')
}

function validId(value: unknown): value is string | number {
  return (
    (typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' && value.length > 0 && value.length <= 160)
  )
}

export function taskDockerCodexResponseId(value: unknown): string | number | undefined {
  return object(value) && validId(value.id) ? value.id : undefined
}

function boundedPositive(value: unknown, maximum: number): number {
  if (value === undefined || value === null) {
    return maximum
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    refuse()
  }
  return value
}

function guardDirectory(params: Record<string, unknown>): void {
  if (params.cwd != null && params.cwd !== TASK_DOCKER_WORKSPACE) {
    refuse()
  }
  if (params.approvalPolicy != null && params.approvalPolicy !== 'never') {
    refuse()
  }
}

function guardExternalSandbox(value: unknown): void {
  if (value === undefined || value === null) {
    return
  }
  if (
    !object(value) ||
    Object.keys(value).length !== 2 ||
    value.type !== externalSandbox.type ||
    value.networkAccess !== externalSandbox.networkAccess
  ) {
    refuse()
  }
}

function guardKeys(params: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(params).some((key) => !allowed.has(key))) {
    refuse()
  }
}

export function taskDockerCodexFrameParams(
  frame: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (frame.params === undefined) {
    return undefined
  }
  if (!object(frame.params)) {
    refuse()
  }
  return frame.params
}

/** External sandbox policy is valid only with the separately verified Docker boundary. */
export function guardTaskDockerCodexFrame(value: unknown): Record<string, unknown> {
  if (!object(value) || (value.jsonrpc !== undefined && value.jsonrpc !== '2.0')) {
    refuse()
  }
  if (value.method === undefined) {
    if (
      !validId(value.id) ||
      'result' in value === 'error' in value ||
      Object.keys(value).some((key) => !['id', 'result', 'error', 'jsonrpc'].includes(key))
    ) {
      refuse()
    }
    return value
  }
  if (
    Object.keys(value).some((key) => !envelopeKeys.has(key)) ||
    (value.id !== undefined && !validId(value.id)) ||
    typeof value.method !== 'string'
  ) {
    refuse()
  }
  const params = taskDockerCodexFrameParams(value) ?? {}
  if (readMethods.has(value.method)) {
    return value
  }
  guardDirectory(params)
  if (value.method === 'thread/start' || value.method === 'thread/resume') {
    guardKeys(params, threadKeys)
    if (params.sandbox != null && params.sandbox !== 'workspace-write') {
      refuse()
    }
    if (params.modelProvider != null && params.modelProvider !== TASK_DOCKER_MODEL_PROVIDER) {
      refuse()
    }
    if (
      params.path != null &&
      (value.method !== 'thread/resume' ||
        typeof params.path !== 'string' ||
        !params.path.startsWith(`${TASK_DOCKER_CODEX_HOME}/sessions/`) ||
        posix.normalize(params.path) !== params.path ||
        params.path.includes('\0'))
    ) {
      refuse()
    }
    return {
      ...value,
      params: {
        ...params,
        cwd: TASK_DOCKER_WORKSPACE,
        modelProvider: TASK_DOCKER_MODEL_PROVIDER,
        sandbox: 'workspace-write',
        approvalPolicy: 'never'
      }
    }
  }
  if (value.method === 'turn/start') {
    guardKeys(params, turnKeys)
    guardExternalSandbox(params.sandboxPolicy)
    return {
      ...value,
      params: {
        ...params,
        cwd: TASK_DOCKER_WORKSPACE,
        sandboxPolicy: { ...externalSandbox },
        approvalPolicy: 'never'
      }
    }
  }
  if (value.method === 'command/exec') {
    guardKeys(params, commandKeys)
    guardExternalSandbox(params.sandboxPolicy)
    if (
      !Array.isArray(params.command) ||
      !params.command.length ||
      params.command.length > 64 ||
      params.command.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
      Buffer.byteLength(JSON.stringify(params.command)) > 128 * 1024
    ) {
      refuse()
    }
    return {
      ...value,
      params: {
        ...params,
        cwd: TASK_DOCKER_WORKSPACE,
        sandboxPolicy: { ...externalSandbox },
        timeoutMs: boundedPositive(params.timeoutMs, TASK_DOCKER_COMMAND_TIMEOUT_MS),
        outputBytesCap: boundedPositive(params.outputBytesCap, TASK_DOCKER_COMMAND_OUTPUT_BYTES)
      }
    }
  }
  return refuse()
}
