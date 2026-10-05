import type {
  CodexAppServerConnection,
  CodexAppServerServerRequest
} from '../codex/codex-app-server-connection'
import {
  TASK_MODEL_RPC_CANCEL,
  TASK_MODEL_RPC_ID_PREFIX,
  TASK_MODEL_RPC_LIMIT,
  TASK_MODEL_RPC_NEXT,
  TASK_MODEL_RPC_START,
  type TaskModelChannel
} from './task-model-channel-protocol'

const PRIVATE_ID =
  /^hive-model-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-(0|[1-9][0-9]{0,15})$/

export function isTaskDockerModelId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(TASK_MODEL_RPC_ID_PREFIX)
}

/** Private correlation shares the existing transport; the Host channel owns every authority check. */
export function createTaskDockerModelChannelPort(options: {
  channel?: TaskModelChannel
  connection: () => CodexAppServerConnection | undefined
  assertCurrent: () => void
  onFailure: () => void
}) {
  let nonce: string | undefined
  let messages = 0
  let pending = 0
  let closed = false
  let failed = false
  let unsubscribe: (() => void) | undefined
  const fail = () => {
    if (closed || failed) {
      return
    }
    failed = true
    closed = true
    options.onFailure()
  }
  unsubscribe = options.channel?.onFailure(fail)
  const live = () => {
    options.assertCurrent()
    const connection = options.connection()
    if (closed || !connection || connection.closed) {
      throw new Error('TASK_MODEL_CHANNEL_UNAVAILABLE')
    }
    return connection
  }
  return {
    handle(request: CodexAppServerServerRequest): boolean {
      if (!request.method.startsWith('hive/model/') && !isTaskDockerModelId(request.id)) {
        return false
      }
      if (closed) {
        return true
      }
      const privateId = typeof request.id === 'string' ? PRIVATE_ID.exec(request.id) : null
      if (
        !options.channel ||
        typeof request.id !== 'string' ||
        !privateId ||
        (nonce !== undefined && privateId[1] !== nonce) ||
        Number(privateId[2]) !== messages ||
        messages >= TASK_MODEL_RPC_LIMIT ||
        pending >= 2 ||
        ![TASK_MODEL_RPC_START, TASK_MODEL_RPC_NEXT, TASK_MODEL_RPC_CANCEL].includes(request.method)
      ) {
        fail()
        return true
      }
      const id = request.id
      const channel = options.channel
      nonce = privateId[1]
      messages++
      pending++
      void Promise.resolve()
        .then<unknown>(() => {
          live()
          if (request.method === TASK_MODEL_RPC_START) {
            return channel.start(request.params)
          }
          if (request.method === TASK_MODEL_RPC_NEXT) {
            return channel.next(request.params)
          }
          return channel.cancel(request.params)
        })
        .then((result) => {
          if (closed) {
            return
          }
          live().respond(id, result)
          options.assertCurrent()
        })
        .catch(fail)
        .finally(() => {
          pending--
        })
      return true
    },
    notification(method: string): boolean {
      if (!method.startsWith('hive/model/')) {
        return false
      }
      fail()
      return true
    },
    unhandled(payload: unknown): boolean {
      if (
        typeof payload !== 'object' ||
        payload === null ||
        Array.isArray(payload) ||
        !('id' in payload) ||
        !isTaskDockerModelId(payload.id)
      ) {
        return false
      }
      fail()
      return true
    },
    async close(): Promise<boolean> {
      closed = true
      unsubscribe?.()
      try {
        await options.channel?.close()
        return true
      } catch {
        return false
      }
    }
  }
}
