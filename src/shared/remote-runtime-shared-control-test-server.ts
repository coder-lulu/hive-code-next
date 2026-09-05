import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { generateKeyPair, publicKeyToBase64 } from './e2ee-crypto'
import { DesktopMobileE2EEV2Session } from './runtime-e2ee-server-session'
import { encodePairingOffer, parsePairingCode, type PairingOffer } from './pairing'

export type SharedControlTestServer = {
  pairing: PairingOffer
  requests: { id: string; method: string; params?: unknown }[]
  auths: unknown[]
  connectionCount: () => number
  flushDelayedResponses: () => void
  closeClients: () => void
}

type ServerOptions = {
  delaySubscriptionReady?: boolean
  sendKeepaliveBeforeResponse?: boolean
  keepaliveDelayMs?: number
  responseDelayMs?: number
  sendBinaryAfterAuth?: boolean
  sendUnknownResponseBeforeResponse?: boolean
  closeAfterFirstStreamingResponse?: boolean
  closeBeforeResponse?: boolean
  suppressReadyFrame?: boolean
  suppressReadyFrameCount?: number
  disableAutoPong?: boolean
  delayedMethods?: string[]
  silentMethods?: string[]
}

const servers: WebSocketServer[] = []

export async function closeSharedControlTestServers(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          for (const client of server.clients) {
            client.close()
          }
          server.close(() => resolve())
        })
    )
  )
}

export async function createSharedControlTestServer(
  options: ServerOptions = {}
): Promise<SharedControlTestServer> {
  const serverKeyPair = generateKeyPair()
  const requests: SharedControlTestServer['requests'] = []
  const auths: unknown[] = []
  const delayedResponses: (() => void)[] = []
  let connectionCount = 0
  let closedAfterFirstStreamingResponse = false
  // host must match the 127.0.0.1 clients dial: a wildcard bind lets a foreign loopback listener claim the port and answer here.
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    autoPong: options.disableAutoPong !== true
  })
  servers.push(wss)

  wss.on('connection', (ws) => {
    connectionCount += 1
    let session: DesktopMobileE2EEV2Session | null = null
    let authenticated = false
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        return
      }
      const frame = data.toString()
      if (!session) {
        session = DesktopMobileE2EEV2Session.create({
          hello: JSON.parse(frame),
          serverSecretKey: serverKeyPair.secretKey,
          expectedContext: { transport: 'direct' }
        })
        if (!session) {
          ws.close()
          return
        }
        if (
          options.suppressReadyFrame ||
          connectionCount <= (options.suppressReadyFrameCount ?? 0)
        ) {
          return
        }
        ws.send(JSON.stringify(session.ready))
        return
      }
      const plaintext = session.openText(frame)
      if (!plaintext) {
        return
      }
      if (!authenticated) {
        auths.push(JSON.parse(plaintext))
        authenticated = true
        sendEncrypted(ws, session, {
          type: 'e2ee_authenticated',
          v: 2,
          transcriptHashB64: session.transcriptHashB64
        })
        if (options.sendBinaryAfterAuth) {
          ws.send(Buffer.from([1, 2, 3]), { binary: true })
        }
        return
      }
      handleRequest(
        ws,
        session,
        requests,
        JSON.parse(plaintext),
        {
          ...options,
          closeAfterStreamingResponse: () => {
            if (!options.closeAfterFirstStreamingResponse || closedAfterFirstStreamingResponse) {
              return false
            }
            closedAfterFirstStreamingResponse = true
            return true
          }
        },
        delayedResponses
      )
    })
  })

  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const address = wss.address() as AddressInfo
  const pairing = parsePairingCode(
    encodePairingOffer({
      v: 2,
      endpoint: `ws://127.0.0.1:${address.port}`,
      deviceToken: 'device-token',
      publicKeyB64: publicKeyToBase64(serverKeyPair.publicKey)
    })
  )
  if (!pairing) {
    throw new Error('Failed to create test pairing')
  }
  return {
    pairing,
    requests,
    auths,
    connectionCount: () => connectionCount,
    flushDelayedResponses: () => delayedResponses.splice(0).forEach((send) => send()),
    closeClients: () => wss.clients.forEach((client) => client.close(4001, 'test close'))
  }
}

function handleRequest(
  ws: WebSocket,
  session: DesktopMobileE2EEV2Session,
  requests: SharedControlTestServer['requests'],
  request: { id: string; method: string; params?: unknown },
  options: ServerOptions & { closeAfterStreamingResponse?: () => boolean },
  delayedResponses: (() => void)[]
): void {
  requests.push(request)
  if (options.sendKeepaliveBeforeResponse && options.keepaliveDelayMs !== undefined) {
    const timer = setInterval(
      () => sendEncrypted(ws, session, { _keepalive: true }),
      options.keepaliveDelayMs
    )
    ws.once('close', () => clearInterval(timer))
  }
  if (options.silentMethods?.includes(request.method)) {
    return
  }
  if (options.closeBeforeResponse) {
    ws.close(4001, 'test close')
    return
  }
  const streaming = isStreamingMethod(request.method)
  const result = streaming
    ? { type: 'ready', subscriptionId: `${request.method}:subscription` }
    : { method: request.method }
  const sendResponse = (): void => {
    if (options.sendUnknownResponseBeforeResponse) {
      sendEncrypted(ws, session, {
        id: 'unknown-response-id',
        ok: true,
        result: { method: 'unknown' },
        _meta: { runtimeId: 'runtime-test' }
      })
    }
    sendEncrypted(ws, session, {
      id: request.id,
      ok: true,
      result,
      streaming: streaming ? true : undefined,
      _meta: { runtimeId: 'runtime-test' }
    })
  }
  const closeAfterResponse = streaming && options.closeAfterStreamingResponse?.() === true
  if (options.sendKeepaliveBeforeResponse && options.keepaliveDelayMs === undefined) {
    sendEncrypted(ws, session, { _keepalive: true })
  }
  if (options.delaySubscriptionReady && streaming) {
    delayedResponses.push(sendResponse)
    return
  }
  if (options.delayedMethods?.includes(request.method)) {
    delayedResponses.push(sendResponse)
    return
  }
  if (options.responseDelayMs !== undefined) {
    setTimeout(() => {
      sendResponse()
      if (closeAfterResponse) {
        setTimeout(() => ws.close(), 0)
      }
    }, options.responseDelayMs)
    return
  }
  sendResponse()
  if (closeAfterResponse) {
    setTimeout(() => ws.close(), 0)
  }
}

function isStreamingMethod(method: string): boolean {
  return (
    method.endsWith('.subscribe') ||
    method === 'session.tabs.subscribeAll' ||
    method === 'files.watch'
  )
}

function sendEncrypted(ws: WebSocket, session: DesktopMobileE2EEV2Session, message: unknown): void {
  ws.send(session.sealText(JSON.stringify(message)))
}
