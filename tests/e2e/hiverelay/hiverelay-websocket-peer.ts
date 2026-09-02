import WebSocketClient, { type RawData, type WebSocket } from 'ws'
import { encodeWireJson } from './hiverelay-test-wire'

export type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
  resolved: () => boolean
}

export function deferred<T>(): Deferred<T> {
  let complete = false
  let fulfilled = false
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: Error) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: (value) => {
      if (!complete) {
        complete = true
        fulfilled = true
        resolvePromise(value)
      }
    },
    reject: (error) => {
      if (!complete) {
        complete = true
        rejectPromise(error)
      }
    },
    resolved: () => fulfilled
  }
}

export function webSocketUrl(cellUrl: string, path: string): string {
  const base = new URL(cellUrl)
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('Cell URL must be an origin without credentials, query, or fragment')
  }
  if (base.protocol === 'http:') {
    base.protocol = 'ws:'
  } else if (base.protocol === 'https:') {
    base.protocol = 'wss:'
  } else if (base.protocol !== 'ws:' && base.protocol !== 'wss:') {
    throw new Error(`Unsupported Cell URL protocol: ${base.protocol}`)
  }
  base.pathname = path
  return base.toString()
}

export function openWebSocket(
  cellUrl: string,
  path: string,
  options: { authorization?: string } = {}
): WebSocketClient {
  return new WebSocketClient(webSocketUrl(cellUrl, path), {
    perMessageDeflate: false,
    maxPayload: 8_388_690,
    ...(options.authorization
      ? { headers: { authorization: `Bearer ${options.authorization}` } }
      : {})
  })
}

export function waitForOpen(socket: WebSocketClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = (): void => {
      socket.off('error', onError)
      resolve()
    }
    const onError = (error: Error): void => {
      socket.off('open', onOpen)
      reject(error)
    }
    socket.once('open', onOpen)
    socket.once('error', onError)
  })
}

export function wireText(raw: RawData): string {
  return rawBuffer(raw).toString('utf8')
}

function rawBuffer(raw: RawData): Buffer {
  if (Array.isArray(raw)) {
    return Buffer.concat(raw)
  }
  return raw instanceof ArrayBuffer ? Buffer.from(raw) : raw
}

export function sendJson(socket: WebSocket, message: object): void {
  socket.send(encodeWireJson(message))
}

export class BinaryInbox {
  private readonly queued: Uint8Array[] = []
  private readonly waiting: Deferred<Uint8Array>[] = []

  push(raw: RawData): void {
    const bytes = rawBuffer(raw)
    const next = this.waiting.shift()
    if (next) {
      next.resolve(new Uint8Array(bytes))
    } else {
      this.queued.push(new Uint8Array(bytes))
    }
  }

  next(): Promise<Uint8Array> {
    const queued = this.queued.shift()
    if (queued) {
      return Promise.resolve(queued)
    }
    const next = deferred<Uint8Array>()
    this.waiting.push(next)
    return next.promise
  }

  reject(error: Error): void {
    for (const waiter of this.waiting.splice(0)) {
      waiter.reject(error)
    }
  }
}
