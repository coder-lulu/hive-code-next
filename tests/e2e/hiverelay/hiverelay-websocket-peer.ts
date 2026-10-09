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
  options: { authorization?: string; origin?: string } = {}
): WebSocketClient {
  return new WebSocketClient(webSocketUrl(cellUrl, path), {
    perMessageDeflate: false,
    maxPayload: 8_388_690,
    ...(options.origin || options.authorization
      ? {
          headers: {
            ...(options.origin ? { origin: options.origin } : {}),
            ...(options.authorization ? { authorization: `Bearer ${options.authorization}` } : {})
          }
        }
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

export function sendJson(socket: WebSocket, message: Record<string, unknown>): void {
  socket.send(encodeWireJson(message))
}

export const BINARY_INBOX_OVERFLOW_CLOSE = 1013
export const BINARY_INBOX_OVERFLOW_REASON = 'INBOX_CAPACITY_EXCEEDED'

class FixedQueue<T> {
  private readonly values: (T | undefined)[]
  private head = 0
  private size = 0

  constructor(private readonly capacity: number) {
    this.values = Array.from<T | undefined>({ length: capacity })
  }

  push(value: T): boolean {
    if (this.size === this.capacity) {
      return false
    }
    this.values[(this.head + this.size) % this.capacity] = value
    this.size += 1
    return true
  }

  shift(): T | undefined {
    if (this.size === 0) {
      return undefined
    }
    const value = this.values[this.head]
    this.values[this.head] = undefined
    this.head = (this.head + 1) % this.capacity
    this.size -= 1
    return value
  }

  clear(): void {
    this.values.fill(undefined)
    this.head = 0
    this.size = 0
  }
}

export class BinaryInbox {
  private readonly queued: FixedQueue<Uint8Array>
  private readonly waiting: FixedQueue<Deferred<Uint8Array>>
  private failure: Error | null = null

  constructor(capacity = 32) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Binary inbox capacity must be a positive safe integer')
    }
    this.queued = new FixedQueue(capacity)
    this.waiting = new FixedQueue(capacity)
  }

  push(raw: RawData): boolean {
    if (this.failure) {
      return false
    }
    const bytes = rawBuffer(raw)
    const next = this.waiting.shift()
    if (next) {
      next.resolve(new Uint8Array(bytes))
      return true
    }
    if (!this.queued.push(new Uint8Array(bytes))) {
      this.reject(new Error('Binary inbox capacity exceeded'))
      return false
    }
    return true
  }

  next(): Promise<Uint8Array> {
    if (this.failure) {
      return Promise.reject(this.failure)
    }
    const queued = this.queued.shift()
    if (queued) {
      return Promise.resolve(queued)
    }
    const next = deferred<Uint8Array>()
    if (!this.waiting.push(next)) {
      return Promise.reject(new Error('Binary inbox waiter capacity exceeded'))
    }
    return next.promise
  }

  reject(error: Error): void {
    if (this.failure) {
      return
    }
    this.failure = error
    this.queued.clear()
    for (let waiter = this.waiting.shift(); waiter; waiter = this.waiting.shift()) {
      waiter.reject(error)
    }
  }
}

export function queueBinaryFrame(
  socket: Pick<WebSocket, 'close'>,
  inbox: BinaryInbox,
  raw: RawData
): void {
  if (!inbox.push(raw)) {
    socket.close(BINARY_INBOX_OVERFLOW_CLOSE, BINARY_INBOX_OVERFLOW_REASON)
  }
}
