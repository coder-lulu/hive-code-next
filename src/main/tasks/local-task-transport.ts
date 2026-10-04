import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { TaskExecutionCaller, TaskExecutionHost } from './task-execution-host'
import { TaskExecutionError } from './task-execution-error'
import { TaskOpaqueRef } from '../../shared/task-execution/task-execution-primitives'
import type { HiveRuntimeBindingPurpose } from './paperclip-adapter-contract'
import {
  LocalTaskRuntimeOwnerSchema,
  TaskDeliveryTokenSchema
} from '../../shared/task-execution/task-command-delivery'

export const TASK_TRANSPORT_MAX_BYTES = 64 * 1024
const errorStatus = (code: TaskExecutionError['code']) =>
  ({
    INVALID_REQUEST: 400,
    CAPABILITY_UNAVAILABLE: 503,
    FORBIDDEN: 403,
    REVISION_CONFLICT: 409,
    IDEMPOTENCY_CONFLICT: 409,
    WORKSPACE_BUSY: 409,
    TASK_BUSY: 409,
    OUTCOME_UNKNOWN: 409,
    EXECUTION_NOT_FOUND: 404,
    CAPACITY_EXCEEDED: 429,
    SERVICE_UNAVAILABLE: 503
  })[code]

async function readTaskCommand(request: IncomingMessage) {
  const declaredSize = Number(request.headers['content-length'])
  if (declaredSize > TASK_TRANSPORT_MAX_BYTES) {
    throw Object.assign(new TaskExecutionError('INVALID_REQUEST'), { status: 413 })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > TASK_TRANSPORT_MAX_BYTES) {
      request.resume()
      throw Object.assign(new TaskExecutionError('INVALID_REQUEST'), { status: 413 })
    }
    chunks.push(bytes)
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)))
  } catch {
    throw new TaskExecutionError('INVALID_REQUEST')
  }
}

/** Loopback is a network restriction; a separate restricted service credential authenticates every call. */
export async function startLocalTaskTransport(options: {
  host: Pick<TaskExecutionHost, 'start' | 'observe' | 'cancel' | 'reconcile'>
  authenticate: (bearer: string) => TaskExecutionCaller | null
  capabilities: (caller: TaskExecutionCaller) => unknown
  currentOwner?: (caller: TaskExecutionCaller) => unknown
  resolveBinding?: (
    companyId: string,
    runId: string,
    purpose: HiveRuntimeBindingPurpose,
    caller: TaskExecutionCaller
  ) => Promise<unknown>
}) {
  let closed = false
  let closing: Promise<void> | undefined
  let authority = ''
  const send = (response: ServerResponse, status: number, value: unknown) => {
    if (response.destroyed || response.writableEnded) {
      return
    }
    const body = JSON.stringify(value)
    if (Buffer.byteLength(body) > TASK_TRANSPORT_MAX_BYTES) {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({ error: { code: 'CAPACITY_EXCEEDED' } }))
      return
    }
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(body)
  }
  const server = createServer(async (request, response) => {
    try {
      if (
        closed ||
        request.headers.host !== authority ||
        request.headers.origin ||
        request.headers['sec-fetch-site']
      ) {
        throw new TaskExecutionError('FORBIDDEN')
      }
      const header = request.headers.authorization ?? ''
      const authenticated = header.startsWith('Bearer ')
        ? options.authenticate(header.slice(7))
        : null
      if (!authenticated) {
        send(response, 401, { error: { code: 'FORBIDDEN' } })
        return
      }
      const deliveryHeaders = [
        'x-hive-delivery-owner',
        'x-hive-delivery-lease',
        'x-hive-delivery-generation'
      ]
      let delivery
      if (deliveryHeaders.some((name) => request.headers[name] !== undefined)) {
        const generation = request.headers['x-hive-delivery-generation']
        if (typeof generation !== 'string' || !/^[1-9][0-9]{0,15}$/.test(generation)) {
          throw new TaskExecutionError('FORBIDDEN')
        }
        const parsed = TaskDeliveryTokenSchema.safeParse({
          ownerId: request.headers['x-hive-delivery-owner'],
          leaseRef: request.headers['x-hive-delivery-lease'],
          generation: Number(generation)
        })
        if (!parsed.success) {
          throw new TaskExecutionError('FORBIDDEN')
        }
        delivery = parsed.data
      }
      const caller: TaskExecutionCaller = {
        operationCallerKey: authenticated.operationCallerKey,
        ...(delivery ? { delivery } : {}),
        assertCurrent: () => {
          if (closed) {
            throw new TaskExecutionError('SERVICE_UNAVAILABLE')
          }
          authenticated.assertCurrent?.()
        }
      }
      if (request.url === '/capabilities' && request.method === 'GET') {
        caller.assertCurrent?.()
        send(response, 200, options.capabilities(caller))
        return
      }
      if (request.url === '/execution/owner' && request.method === 'GET' && options.currentOwner) {
        caller.assertCurrent?.()
        const owner = LocalTaskRuntimeOwnerSchema.safeParse(options.currentOwner(caller))
        if (!owner.success) {
          throw new TaskExecutionError('FORBIDDEN')
        }
        send(response, 200, owner.data)
        return
      }
      const bindingPath = request.url?.match(
        /^\/execution\/binding\/([^/?]+)\/([^/?]+)\?purpose=(execute|recover)$/
      )
      if (bindingPath && request.method === 'GET' && options.resolveBinding) {
        const decode = (value: string) => {
          try {
            return decodeURIComponent(value)
          } catch {
            throw new TaskExecutionError('INVALID_REQUEST')
          }
        }
        const companyId = TaskOpaqueRef.safeParse(decode(bindingPath[1]!))
        const runId = TaskOpaqueRef.safeParse(decode(bindingPath[2]!))
        if (!companyId.success || !runId.success) {
          throw new TaskExecutionError('INVALID_REQUEST')
        }
        caller.assertCurrent?.()
        const purpose = bindingPath[3] === 'execute' ? 'execute' : 'recover'
        const binding = await options.resolveBinding(companyId.data, runId.data, purpose, caller)
        caller.assertCurrent?.()
        send(response, 200, binding)
        return
      }
      const routes = {
        '/execution/start': 'start',
        '/execution/observe': 'observe',
        '/execution/cancel': 'cancel',
        '/execution/reconcile': 'reconcile'
      } as const
      const route = Object.entries(routes).find(([path]) => path === request.url)?.[1]
      if (
        !route ||
        request.method !== 'POST' ||
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
      ) {
        throw new TaskExecutionError('INVALID_REQUEST')
      }
      const command = await readTaskCommand(request)
      caller.assertCurrent?.()
      send(response, route === 'start' ? 202 : 200, await options.host[route](command, caller))
    } catch (error) {
      const code = error instanceof TaskExecutionError ? error.code : 'SERVICE_UNAVAILABLE'
      const status =
        error instanceof TaskExecutionError
          ? 'status' in error && error.status === 413
            ? 413
            : errorStatus(code)
          : 503
      send(response, status, { error: { code } })
    }
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 1000
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new TaskExecutionError('SERVICE_UNAVAILABLE')
  }
  authority = `127.0.0.1:${address.port}`
  return {
    baseUrl: `http://${authority}`,
    close() {
      closed = true
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        // Closing HTTP requests is not proof that an admitted task or writer has stopped.
        server.closeAllConnections()
      })
      return closing
    }
  }
}
