import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import type { WebSocket } from 'ws'
import { createStaticWebClientHandler } from './static-web-client-handler'

export type WebSocketHttpRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => boolean | Promise<boolean>

export type WebSocketConnectionRequest = Readonly<{
  pathname: string | null
  origin: string | null
}>

export function createWebSocketHttpRequestListener(
  staticRoot: string | undefined,
  routeHandler: WebSocketHttpRouteHandler | undefined
): RequestListener | undefined {
  const staticHandler = staticRoot ? createStaticWebClientHandler(staticRoot) : undefined
  if (!routeHandler && !staticHandler) {
    return undefined
  }
  return (request, response) => {
    void routeWebSocketHttpRequest(request, response, routeHandler, staticHandler)
  }
}

async function routeWebSocketHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  routeHandler: WebSocketHttpRouteHandler | undefined,
  staticHandler: RequestListener | undefined
): Promise<void> {
  try {
    if (await routeHandler?.(request, response)) {
      return
    }
    if (staticHandler) {
      staticHandler(request, response)
      return
    }
    response.statusCode = 404
    response.end()
  } catch {
    if (!response.headersSent) {
      response.statusCode = 500
      response.end()
      return
    }
    response.destroy()
  }
}

export function parseWebSocketConnectionRequest(
  ws: WebSocket,
  request: IncomingMessage,
  requests: WeakMap<WebSocket, WebSocketConnectionRequest>
): void {
  let pathname: string | null = null
  try {
    const parsed = request.url ? new URL(request.url, 'http://127.0.0.1') : null
    pathname = parsed && !parsed.search && !parsed.hash ? parsed.pathname : null
  } catch {
    pathname = null
  }
  const origin = request.headers.origin
  requests.set(ws, {
    pathname,
    origin: typeof origin === 'string' ? origin : null
  })
}
