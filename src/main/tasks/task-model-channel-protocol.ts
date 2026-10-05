/** Private transport correlation only. A bridge ID never grants task or account authority. */
export const TASK_MODEL_RPC_ID_PREFIX = 'hive-model-'
export const TASK_MODEL_RPC_START = 'hive/model/start'
export const TASK_MODEL_RPC_NEXT = 'hive/model/next'
export const TASK_MODEL_RPC_CANCEL = 'hive/model/cancel'
export const TASK_MODEL_LOOPBACK_HOST = '127.0.0.1'
export const TASK_MODEL_LOOPBACK_PORT = 41000
export const TASK_MODEL_LOOPBACK_PATH = '/v1/responses'
export const TASK_MODEL_REQUEST_BYTES = 4 * 1024 * 1024
export const TASK_MODEL_RESPONSE_BYTES = 16 * 1024 * 1024
export const TASK_MODEL_CHUNK_BYTES = 48 * 1024
export const TASK_MODEL_EVENT_BYTES = 1024 * 1024
export const TASK_MODEL_EVENT_LIMIT = 65_536
export const TASK_MODEL_REQUEST_LIMIT = 16
// Covers event-at-a-time reads and chunk draining for every admitted HTTP response.
export const TASK_MODEL_RPC_LIMIT =
  TASK_MODEL_REQUEST_LIMIT *
  (TASK_MODEL_EVENT_LIMIT + Math.ceil(TASK_MODEL_RESPONSE_BYTES / TASK_MODEL_CHUNK_BYTES) + 2)
export const TASK_MODEL_REQUEST_TIMEOUT_MS = 120_000
export const TASK_MODEL_IDLE_TIMEOUT_MS = 30_000
export const TASK_MODEL_RPC_TIMEOUT_MS = 35_000

export type TaskModelStartParams = { requestId: string; bodyBase64: string }
export type TaskModelNextParams = { requestId: string; sequence: number }
export type TaskModelCancelParams = { requestId: string }
export type TaskModelStartResult = { status: 200; contentType: 'text/event-stream' }
export type TaskModelNextResult = { sequence: number; bodyBase64: string; done: boolean }
export type TaskModelCancelResult = { cancelled: true }

export type TaskModelChannel = {
  start(params: unknown): Promise<TaskModelStartResult>
  next(params: unknown): Promise<TaskModelNextResult>
  cancel(params: unknown): Promise<TaskModelCancelResult>
  onFailure(listener: () => void): () => void
  close(): Promise<void>
}
