import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  HttpFailure,
  TASK_MODEL_HEADER_BYTES,
  readTaskDockerModelBody,
  validateTaskDockerModelHeaders
} from './task-docker-model-http-input'
import {
  TASK_MODEL_CHUNK_BYTES,
  TASK_MODEL_IDLE_TIMEOUT_MS,
  TASK_MODEL_LOOPBACK_HOST,
  TASK_MODEL_LOOPBACK_PATH,
  TASK_MODEL_LOOPBACK_PORT,
  TASK_MODEL_REQUEST_LIMIT,
  TASK_MODEL_REQUEST_TIMEOUT_MS,
  TASK_MODEL_RESPONSE_BYTES,
  TASK_MODEL_RPC_CANCEL,
  TASK_MODEL_RPC_NEXT,
  TASK_MODEL_RPC_START
} from './task-model-channel-protocol'

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function reject(response: ServerResponse, status: number): void {
  if (response.destroyed) {
    return
  }
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(status, { 'content-type': 'text/plain', connection: 'close' })
  response.once('finish', () => response.socket?.destroy())
  response.end('TASK_MODEL_REQUEST_FAILED\n')
}

export async function createTaskDockerModelHttpBridge(options: {
  request: (method: string, params: unknown) => Promise<unknown>
  onFailure: () => void
  port?: number
}): Promise<{ address: { host: string; port: number }; close: () => Promise<void> }> {
  if (options.port !== undefined && options.port !== 0) {
    throw new HttpFailure()
  }
  let closed = false
  let closePromise: Promise<void> | undefined
  let accepted = 0
  let boundPort = TASK_MODEL_LOOPBACK_PORT
  let abortActive: (() => void) | undefined
  const sockets = new Set<Socket>()
  const server = createServer(
    { maxHeaderSize: TASK_MODEL_HEADER_BYTES, connectionsCheckingInterval: 1000 },
    (request, response) => {
      if (closed) {
        reject(response, 503)
        return
      }
      if (request.method !== 'POST') {
        reject(response, 405)
        return
      }
      if (request.url !== TASK_MODEL_LOOPBACK_PATH) {
        reject(response, 404)
        return
      }
      try {
        validateTaskDockerModelHeaders(request, boundPort)
      } catch (error) {
        reject(response, error instanceof HttpFailure ? error.status : 400)
        return
      }
      if (abortActive || accepted >= TASK_MODEL_REQUEST_LIMIT) {
        reject(response, 429)
        return
      }
      accepted++
      const requestId = randomUUID()
      let finished = false
      let aborted = false
      let sentStart = false
      let cancelled = false
      let rejectAbort!: (error: Error) => void
      const abortPromise = new Promise<never>((_resolve, rejectPromise) => {
        rejectAbort = rejectPromise
      })
      void abortPromise.catch(() => undefined)
      const cancel = () => {
        if (cancelled || !sentStart) {
          return
        }
        cancelled = true
        try {
          void options.request(TASK_MODEL_RPC_CANCEL, { requestId }).catch(() => undefined)
        } catch {
          /* Closed RPC. */
        }
      }
      const abort = (status?: number) => {
        if (aborted || finished) {
          return
        }
        aborted = true
        request.pause()
        rejectAbort(new HttpFailure(status))
        cancel()
        if (status !== undefined) {
          reject(response, status)
        } else {
          response.destroy()
        }
      }
      const absolute = setTimeout(() => abort(408), TASK_MODEL_REQUEST_TIMEOUT_MS)
      absolute.unref()
      let idle = setTimeout(() => abort(408), TASK_MODEL_IDLE_TIMEOUT_MS)
      idle.unref()
      const touch = () => {
        idle.refresh()
      }
      const onDisconnect = () => abort()
      request.once('aborted', onDisconnect).once('error', onDisconnect)
      response.once('close', onDisconnect).once('error', onDisconnect)
      abortActive = onDisconnect
      const call = async (method: string, params: unknown) => {
        if (aborted || closed) {
          throw new HttpFailure()
        }
        const result = await Promise.race([
          Promise.resolve().then(() => options.request(method, params)),
          abortPromise
        ])
        touch()
        return result
      }
      const drain = () =>
        new Promise<void>((resolve, rejectDrain) => {
          const clean = () => {
            response.off('drain', done).off('close', error).off('error', error)
          }
          const done = () => {
            clean()
            touch()
            resolve()
          }
          const error = () => {
            clean()
            rejectDrain(new HttpFailure())
          }
          response.once('drain', done).once('close', error).once('error', error)
        })
      void (async () => {
        try {
          const body = await Promise.race([readTaskDockerModelBody(request, touch), abortPromise])
          if (!body.length) {
            throw new HttpFailure(400)
          }
          sentStart = true
          const start = await call(TASK_MODEL_RPC_START, {
            requestId,
            bodyBase64: body.toString('base64')
          })
          if (
            !object(start) ||
            Object.keys(start).length !== 2 ||
            start.status !== 200 ||
            start.contentType !== 'text/event-stream'
          ) {
            throw new HttpFailure()
          }
          let total = 0
          for (let sequence = 0; ; sequence++) {
            const next = await call(TASK_MODEL_RPC_NEXT, { requestId, sequence })
            if (
              !object(next) ||
              Object.keys(next).length !== 3 ||
              next.sequence !== sequence ||
              typeof next.bodyBase64 !== 'string' ||
              next.bodyBase64.length > Math.ceil(TASK_MODEL_CHUNK_BYTES / 3) * 4 ||
              typeof next.done !== 'boolean'
            ) {
              throw new HttpFailure()
            }
            const chunk = Buffer.from(next.bodyBase64, 'base64')
            total += chunk.length
            if (
              chunk.toString('base64') !== next.bodyBase64 ||
              chunk.length > TASK_MODEL_CHUNK_BYTES ||
              total > TASK_MODEL_RESPONSE_BYTES ||
              (!chunk.length && !next.done)
            ) {
              throw new HttpFailure()
            }
            if (!response.headersSent) {
              response.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-store',
                connection: 'close'
              })
            }
            if (chunk.length && !response.write(chunk)) {
              await Promise.race([drain(), abortPromise])
            }
            if (next.done) {
              finished = true
              response.end()
              break
            }
          }
        } catch (error) {
          cancel()
          if (!aborted && !closed) {
            reject(response, error instanceof HttpFailure ? error.status : 503)
            if (!(error instanceof HttpFailure) || error.status === 503) {
              options.onFailure()
            }
          }
        } finally {
          clearTimeout(absolute)
          clearTimeout(idle)
          abortActive = undefined
        }
      })()
    }
  )
  server.maxConnections = 2
  server.maxRequestsPerSocket = 1
  server.headersTimeout = TASK_MODEL_IDLE_TIMEOUT_MS
  server.requestTimeout = TASK_MODEL_REQUEST_TIMEOUT_MS
  server.setTimeout(TASK_MODEL_IDLE_TIMEOUT_MS, (socket) => socket.destroy())
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  const refuseSocket = (_request: IncomingMessage | undefined, socket: Duplex) => {
    if (socket.destroyed || !socket.writable || socket.writableEnded) {
      socket.destroy()
      return
    }
    socket.end(
      'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 26\r\n\r\nTASK_MODEL_REQUEST_FAILED\n',
      () => socket.destroy()
    )
  }
  server.on('connect', refuseSocket).on('upgrade', refuseSocket)
  server.on('checkContinue', (_request, response) => reject(response, 400))
  server.on('checkExpectation', (_request, response) => reject(response, 400))
  server.on('clientError', (_error, socket) => refuseSocket(undefined, socket))
  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', () => rejectListen(new HttpFailure()))
    server.listen(options.port ?? TASK_MODEL_LOOPBACK_PORT, TASK_MODEL_LOOPBACK_HOST, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        rejectListen(new HttpFailure())
        return
      }
      boundPort = address.port
      resolve()
    })
  })
  server.on('error', () => {
    if (!closed) {
      options.onFailure()
    }
  })
  return {
    address: { host: TASK_MODEL_LOOPBACK_HOST, port: boundPort },
    close: () => {
      if (closePromise) {
        return closePromise
      }
      closed = true
      abortActive?.()
      for (const socket of sockets) {
        socket.destroy()
      }
      closePromise = new Promise<void>((resolve) => server.close(() => resolve()))
      return closePromise
    }
  }
}
