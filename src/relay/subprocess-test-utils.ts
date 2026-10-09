import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createConnection, type Socket } from 'node:net'
import {
  RELAY_SENTINEL,
  FrameDecoder,
  encodeJsonRpcFrame,
  encodeHandshakeFrame,
  parseJsonRpcMessage,
  parseHandshakeMessage,
  RELAY_VERSION,
  MessageType,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification
} from './protocol'

export type RelayProcess = {
  proc: ChildProcess
  responses: (JsonRpcResponse | JsonRpcNotification)[]
  sentinelReceived: Promise<void>
  send: (method: string, params?: Record<string, unknown>) => number
  sendNotification: (method: string, params?: Record<string, unknown>) => void
  waitForResponse: (id: number, timeoutMs?: number) => Promise<JsonRpcResponse>
  waitForNotification: (method: string, timeoutMs?: number) => Promise<JsonRpcNotification>
  kill: (signal?: NodeJS.Signals) => void
  waitForExit: (timeoutMs?: number) => Promise<number | null>
}

export async function connectRelayTestSocket(
  sockPath: string,
  endpointCredential: string | undefined
): Promise<{ socket: Socket; closed: Promise<void> }> {
  const socket = createConnection({ path: sockPath })
  const closed = new Promise<void>((resolve) => socket.once('close', resolve))
  try {
    await new Promise<void>((resolve, reject) => {
      let accepted = false
      const decoder = new FrameDecoder((frame) => {
        try {
          if (frame.type !== MessageType.Handshake) {
            throw new Error('Expected a relay handshake frame')
          }
          const message = parseHandshakeMessage(frame.payload)
          if (message.type !== 'orca-relay-handshake-ok' || message.version !== RELAY_VERSION) {
            throw new Error(`Relay handshake refused: ${message.type}`)
          }
          accepted = true
          resolve()
        } catch (error) {
          reject(error)
        }
      }, reject)
      socket.on('data', (chunk: Buffer) => decoder.feed(chunk))
      socket.once('error', reject)
      socket.once('close', () => {
        if (!accepted) {
          reject(new Error('Relay socket closed before handshake acceptance'))
        }
      })
      socket.once('connect', () => {
        socket.write(
          encodeHandshakeFrame({
            type: 'orca-relay-handshake',
            version: RELAY_VERSION,
            endpointCredential
          })
        )
      })
    })
    return { socket, closed }
  } catch (error) {
    socket.destroy()
    await closed
    throw error
  }
}

export function spawnRelay(
  entryPath: string,
  args: string[] = [],
  options: Pick<SpawnOptions, 'cwd' | 'env'> = {}
): RelayProcess {
  const proc = spawn('node', [entryPath, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options
  })

  const responses: (JsonRpcResponse | JsonRpcNotification)[] = []
  let nextSeq = 1
  let sentinelResolved = false
  let stdoutBuffer = Buffer.alloc(0)
  let stderrTail = ''
  let sentinelResolve: () => void
  let sentinelReject: (error: Error) => void
  let decoderActive = false

  const sentinelReceived = new Promise<void>((resolve, reject) => {
    sentinelResolve = resolve
    sentinelReject = reject
  })
  // Observe unused readiness failures without changing what an actual await receives.
  void sentinelReceived.catch(() => {})
  const rejectBeforeSentinel = (error: Error): void => {
    if (!sentinelResolved) {
      sentinelReject(error)
    }
  }
  const rejectCloseBeforeSentinel = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (!sentinelResolved) {
      sentinelReject(
        new Error(
          `Relay closed before readiness (code=${code}, signal=${signal})${stderrTail ? `: ${stderrTail.trim()}` : ''}`
        )
      )
    }
  }
  proc.once('error', rejectBeforeSentinel)
  proc.once('close', rejectCloseBeforeSentinel)

  const decoder = new FrameDecoder((frame) => {
    if (frame.type !== MessageType.Regular) {
      return
    }
    try {
      const msg = parseJsonRpcMessage(frame.payload)
      responses.push(msg as JsonRpcResponse | JsonRpcNotification)
    } catch {
      /* skip malformed */
    }
  })

  proc.stdout!.on('data', (chunk: Buffer) => {
    if (!sentinelResolved) {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk])
      const sentinelBuf = Buffer.from(RELAY_SENTINEL, 'utf-8')
      const idx = stdoutBuffer.indexOf(sentinelBuf)
      if (idx !== -1) {
        sentinelResolved = true
        proc.off('error', rejectBeforeSentinel)
        proc.off('close', rejectCloseBeforeSentinel)
        stderrTail = ''
        decoderActive = true
        sentinelResolve()
        const remainder = stdoutBuffer.subarray(idx + sentinelBuf.length)
        if (remainder.length > 0) {
          decoder.feed(remainder)
        }
      }
    } else if (decoderActive) {
      decoder.feed(chunk)
    }
  })

  proc.stderr!.on('data', (chunk: Buffer) => {
    if (!sentinelResolved) {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-8192)
    }
  })

  const send = (method: string, params?: Record<string, unknown>): number => {
    const id = nextSeq++
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {})
    }
    proc.stdin!.write(encodeJsonRpcFrame(req, id, 0))
    return id
  }

  const sendNotification = (method: string, params?: Record<string, unknown>): void => {
    const seq = nextSeq++
    const notif: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {})
    }
    proc.stdin!.write(encodeJsonRpcFrame(notif, seq, 0))
  }

  const waitForResponse = (id: number, timeoutMs = 5000): Promise<JsonRpcResponse> => {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs
      const check = () => {
        const found = responses.find((r) => 'id' in r && r.id === id) as JsonRpcResponse | undefined
        if (found) {
          resolve(found)
          return
        }
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for response id=${id}`))
          return
        }
        setTimeout(check, 10)
      }
      check()
    })
  }

  const waitForNotification = (method: string, timeoutMs = 5000): Promise<JsonRpcNotification> => {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs
      const seen = responses.length
      const check = () => {
        for (let i = seen; i < responses.length; i++) {
          const r = responses[i]
          if ('method' in r && r.method === method) {
            resolve(r as JsonRpcNotification)
            return
          }
        }
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for notification "${method}"`))
          return
        }
        setTimeout(check, 10)
      }
      check()
    })
  }

  const kill = (signal: NodeJS.Signals = 'SIGTERM') => {
    proc.kill(signal)
  }

  const waitForExit = (timeoutMs = 5000): Promise<number | null> => {
    return new Promise((resolve, reject) => {
      if (proc.exitCode !== null) {
        resolve(proc.exitCode)
        return
      }
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for process exit'))
      }, timeoutMs)
      proc.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
  }

  return {
    proc,
    responses,
    sentinelReceived,
    send,
    sendNotification,
    waitForResponse,
    waitForNotification,
    kill,
    waitForExit
  }
}
