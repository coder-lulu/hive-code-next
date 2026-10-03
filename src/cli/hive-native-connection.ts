import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { HiveAiCatalogModel, HiveAiModelSelection } from '../shared/hive-ai-model-catalog'

type Metadata = { baseUrl: string; token: string }
export type HiveNativeLaunch = {
  token: string
  baseUrl: string
  runtimeDirectory: string
  agentDirectory: string
  models: HiveAiCatalogModel[]
  selection: HiveAiModelSelection | null
}

export async function readHiveNativeMetadata(path: string): Promise<Metadata> {
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.baseUrl) ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.token)
  ) {
    throw new Error('HiveCode AI is unavailable. Start HiveCode and sign in first.')
  }
  return value
}

export async function releaseHiveNativeLease(metadata: Metadata, launch: HiveNativeLaunch) {
  await fetch(`${metadata.baseUrl}/lease`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${launch.token}` },
    signal: AbortSignal.timeout(3000),
    redirect: 'error'
  })
    .then((response) => response.body?.cancel())
    .catch(() => undefined)
}

const fail = (response: ServerResponse, status: number, message: string) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify({ error: { type: 'hive_gateway_error', message } }))
}

/** Keep Pi's endpoint stable while the desktop's account broker restarts. Never replay inference. */
export async function startHiveNativeConnection(options: {
  metadataPath: string
  metadata: Metadata
  launch: HiveNativeLaunch
  onRevoked: () => void
}) {
  let metadata = options.metadata
  let launch = options.launch
  let closed = false
  let revoked = false
  let refreshing: Promise<boolean> | null = null
  const requests = new Set<AbortController>()
  const stopRequests = () => {
    for (const controller of requests) {
      controller.abort()
    }
  }
  const revoke = () => {
    if (!revoked && !closed) {
      revoked = true
      stopRequests()
      options.onRevoked()
    }
    return false
  }
  const refresh = async (): Promise<boolean> => {
    if (closed || revoked) {
      return false
    }
    let refused = false
    try {
      const response = await fetch(`${metadata.baseUrl}/lease`, {
        headers: { Authorization: `Bearer ${launch.token}` },
        signal: AbortSignal.timeout(3000),
        redirect: 'error'
      })
      await response.body?.cancel()
      if (response.ok) {
        return !closed && !revoked
      }
      refused = response.status === 401 || response.status === 403
    } catch {
      // A missing desktop is not an account revocation; Pi retains its session, tools and input.
    }
    stopRequests()
    const next = await readHiveNativeMetadata(options.metadataPath).catch(() => null)
    if (!next || (next.token === metadata.token && next.baseUrl === metadata.baseUrl)) {
      return refused ? revoke() : false
    }
    try {
      const response = await fetch(`${next.baseUrl}/launch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${next.token}` },
        signal: AbortSignal.timeout(30_000),
        redirect: 'error'
      })
      if (!response.ok) {
        await response.body?.cancel()
        return response.status === 401 || response.status === 403 ? revoke() : false
      }
      const replacement: HiveNativeLaunch = await response.json()
      // The broker scopes this directory by Cloud origin, account and authorization authority.
      if (
        closed ||
        resolve(replacement.agentDirectory) !== resolve(options.launch.agentDirectory)
      ) {
        await releaseHiveNativeLease(next, replacement)
        return revoke()
      }
      if (replacement.baseUrl !== `${next.baseUrl}/v1`) {
        await releaseHiveNativeLease(next, replacement)
        return revoke()
      }
      await releaseHiveNativeLease(metadata, launch)
      metadata = next
      launch = replacement
      return !closed && !revoked
    } catch {
      return false
    }
  }
  const ensureLease = (): Promise<boolean> => {
    refreshing ??= refresh().finally(() => {
      refreshing = null
    })
    return refreshing
  }
  let authority = ''
  const server = createServer((request, response) => {
    void (async () => {
      if (
        request.headers.host !== authority ||
        request.headers.origin ||
        request.headers['sec-fetch-site'] ||
        request.headers.authorization !== `Bearer ${options.launch.token}`
      ) {
        fail(response, 401, 'Native Hive client required')
        return
      }
      if (
        request.method !== 'POST' ||
        !['/v1/responses', '/v1/chat/completions'].includes(request.url ?? '')
      ) {
        fail(response, 404, 'Unsupported Hive inference route')
        return
      }
      if (!(await ensureLease())) {
        fail(
          response,
          revoked ? 401 : 503,
          'HiveCode connection unavailable. Reconnect and retry this turn.'
        )
        return
      }
      const controller = new AbortController()
      const abort = () => controller.abort()
      response.on('close', abort)
      requests.add(controller)
      const timeout = setTimeout(abort, 600_000)
      try {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of request) {
          size += chunk.length
          if (size > 16 * 1024 * 1024) {
            fail(response, 413, 'Request too large')
            return
          }
          chunks.push(Buffer.from(chunk))
        }
        const upstream = await fetch(`${metadata.baseUrl}${request.url}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${launch.token}`, 'Content-Type': 'application/json' },
          body: Buffer.concat(chunks),
          signal: controller.signal,
          redirect: 'error'
        })
        response.writeHead(upstream.status, {
          'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
          'Cache-Control': 'no-store'
        })
        if (upstream.body) {
          for await (const chunk of upstream.body) {
            if (!response.write(chunk)) {
              await once(response, 'drain', { signal: controller.signal })
            }
          }
        }
        response.end()
      } finally {
        clearTimeout(timeout)
        response.off('close', abort)
        requests.delete(controller)
      }
    })().catch(() => {
      if (response.headersSent) {
        response.destroy()
      } else {
        fail(response, 503, 'HiveCode connection interrupted. Retry this turn after reconnecting.')
      }
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Native Hive connection unavailable')
  }
  authority = `127.0.0.1:${address.port}`
  const heartbeat = setInterval(() => {
    void ensureLease()
  }, 5000)
  heartbeat.unref()
  return {
    baseUrl: `http://${authority}/v1`,
    async close() {
      closed = true
      clearInterval(heartbeat)
      stopRequests()
      server.closeAllConnections()
      await new Promise<void>((accept) => server.close(() => accept()))
      await refreshing
      await releaseHiveNativeLease(metadata, launch)
    }
  }
}
