import { isUtf8 } from 'node:buffer'
import { TASK_MODEL_REQUEST_BYTES } from './task-model-channel-protocol'

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function requireTaskModelParams(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> & { requestId: string } {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    !REQUEST_ID.test(value.requestId)
  ) {
    throw new Error('TASK_MODEL_REQUEST_REFUSED')
  }
  return { requestId: value.requestId, ...Object.fromEntries(Object.entries(value)) }
}

export function decodeTaskModelBody(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil(TASK_MODEL_REQUEST_BYTES / 3) * 4
  ) {
    throw new Error('TASK_MODEL_REQUEST_REFUSED')
  }
  const bytes = Buffer.from(value, 'base64')
  if (
    bytes.length > TASK_MODEL_REQUEST_BYTES ||
    bytes.toString('base64') !== value ||
    !isUtf8(bytes)
  ) {
    throw new Error('TASK_MODEL_REQUEST_REFUSED')
  }
  return bytes.toString('utf8')
}

export function abortTaskModelWait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error('TASK_MODEL_REQUEST_ABORTED'))
    if (signal.aborted) {
      void promise.catch(() => undefined)
      aborted()
      return
    }
    signal.addEventListener('abort', aborted, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}
