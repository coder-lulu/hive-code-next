import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  HIVE_RELAY_CLIENT_PATH_PREFIX,
  HIVE_RELAY_HOST_CONTROL_PATH,
  HIVE_RELAY_HOST_DATA_PATH_PREFIX
} from './hiverelay-test-wire'

export type MockCellRoute =
  | { kind: 'control' }
  | { kind: 'host-data'; connId: string }
  | { kind: 'client'; relayHostId: string }

export function parseMockCellRoute(path: string): MockCellRoute | null {
  try {
    if (path === HIVE_RELAY_HOST_CONTROL_PATH) {
      return { kind: 'control' }
    }
    if (path.startsWith(HIVE_RELAY_HOST_DATA_PATH_PREFIX)) {
      const connId = decodeURIComponent(path.slice(HIVE_RELAY_HOST_DATA_PATH_PREFIX.length))
      return connId ? { kind: 'host-data', connId } : null
    }
    if (path.startsWith(HIVE_RELAY_CLIENT_PATH_PREFIX)) {
      const relayHostId = decodeURIComponent(path.slice(HIVE_RELAY_CLIENT_PATH_PREFIX.length))
      return relayHostId ? { kind: 'client', relayHostId } : null
    }
  } catch {
    return null
  }
  return null
}

export class HiveRelayMockCellServer {
  private readonly webSockets = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 8_388_690
  })
  private readonly http: Server
  private baseUrlValue: string | null = null

  constructor(
    private readonly onConnection: (
      socket: WebSocket,
      request: IncomingMessage,
      route: MockCellRoute
    ) => void
  ) {
    this.http = createServer((_request, response) => {
      response.writeHead(404).end()
    })
    this.http.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head))
  }

  get baseUrl(): string {
    if (!this.baseUrlValue) {
      throw new Error('Mock Cell has not started')
    }
    return this.baseUrlValue
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject)
      this.http.listen(0, '127.0.0.1', () => {
        this.http.off('error', reject)
        resolve()
      })
    })
    const address = this.http.address()
    if (!address || typeof address === 'string') {
      throw new Error('Mock Cell did not bind a TCP address')
    }
    this.baseUrlValue = `http://127.0.0.1:${address.port}`
  }

  async stop(): Promise<void> {
    for (const client of this.webSockets.clients) {
      client.terminate()
    }
    await new Promise<void>((resolve) => this.webSockets.close(() => resolve()))
    if (this.http.listening) {
      await new Promise<void>((resolve) => this.http.close(() => resolve()))
    }
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = new URL(request.url ?? '/', 'http://mock-cell.invalid').pathname
    const route = parseMockCellRoute(path)
    if (!route) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      return
    }
    this.webSockets.handleUpgrade(request, socket, head, (client) => {
      this.onConnection(client, request, route)
    })
  }

}
