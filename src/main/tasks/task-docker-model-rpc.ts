import { randomUUID } from 'node:crypto'
import {
  TASK_MODEL_RPC_CANCEL,
  TASK_MODEL_RPC_ID_PREFIX,
  TASK_MODEL_RPC_LIMIT,
  TASK_MODEL_RPC_NEXT,
  TASK_MODEL_RPC_START,
  TASK_MODEL_RPC_TIMEOUT_MS
} from './task-model-channel-protocol'

const MAX_PENDING = 2
const methods = new Set([TASK_MODEL_RPC_START, TASK_MODEL_RPC_NEXT, TASK_MODEL_RPC_CANCEL])
const failure = () => new Error('TASK_MODEL_RPC_FAILED')
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export type TaskDockerModelRpc = {
  request: (method: string, params: unknown) => Promise<unknown>
  handleResponse: (frame: unknown) => boolean
  close: () => Promise<void>
}

export function createTaskDockerModelRpc(options: {
  write: (frame: string) => Promise<void>
  onFailure: () => void
}): TaskDockerModelRpc {
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const nonce = randomUUID()
  let sequence = 0
  let closed = false
  const finish = (failed: boolean) => {
    if (closed) {
      return
    }
    closed = true
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(failure())
    }
    pending.clear()
    if (failed) {
      options.onFailure()
    }
  }
  return {
    request(method, params) {
      if (closed || !methods.has(method)) {
        return Promise.reject(failure())
      }
      if (pending.size >= MAX_PENDING || sequence >= TASK_MODEL_RPC_LIMIT) {
        finish(true)
        return Promise.reject(failure())
      }
      const id = `${TASK_MODEL_RPC_ID_PREFIX}${nonce}-${sequence++}`
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => finish(true), TASK_MODEL_RPC_TIMEOUT_MS)
        timer.unref()
        pending.set(id, { resolve, reject, timer })
        try {
          const frame = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
          void options.write(frame).catch(() => finish(true))
        } catch {
          finish(true)
        }
      })
    },
    handleResponse(frame) {
      if (
        !object(frame) ||
        typeof frame.id !== 'string' ||
        !frame.id.startsWith(TASK_MODEL_RPC_ID_PREFIX)
      ) {
        return false
      }
      if (closed) {
        return true
      }
      const entry = pending.get(frame.id)
      if (
        !entry ||
        (frame.jsonrpc !== undefined && frame.jsonrpc !== '2.0') ||
        'result' in frame === 'error' in frame ||
        Object.keys(frame).some((key) => !['id', 'result', 'error', 'jsonrpc'].includes(key))
      ) {
        finish(true)
        return true
      }
      if (
        'error' in frame &&
        (!object(frame.error) ||
          typeof frame.error.code !== 'number' ||
          !Number.isSafeInteger(frame.error.code) ||
          typeof frame.error.message !== 'string' ||
          Object.keys(frame.error).some((key) => !['code', 'message'].includes(key)))
      ) {
        finish(true)
        return true
      }
      pending.delete(frame.id)
      clearTimeout(entry.timer)
      if ('error' in frame) {
        entry.reject(failure())
      } else {
        entry.resolve(frame.result)
      }
      return true
    },
    close: async () => finish(false)
  }
}
