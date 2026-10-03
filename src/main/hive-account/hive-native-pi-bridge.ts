import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { once } from 'node:events'
import type { HiveAccountService } from './hive-account-service'
import type { HiveRuntimeCloudAuthorization } from './hive-account-publication'

type Account = Pick<
  HiveAccountService,
  'getRuntimeCloudAuthorization' | 'subscribeRuntimeCloudAuthorization' | 'readAiModels'
>
type Lease = {
  accountId: string
  authorityId: string
  origin: string
  expiresAt: number
  controllers: Set<AbortController>
}
const secret = () => randomBytes(32).toString('base64url')
const equal = (left: string, right: string) =>
  left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right))
const send = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}
const error = (response: ServerResponse, status: number, message: string) =>
  send(response, status, { error: { type: 'hive_gateway_error', message } })

/** Local, inference-only capability broker. Hive login tokens never enter Pi's process. */
export async function startHiveNativePiBridge(options: {
  account: Account
  userDataPath: string
  resourcesDirectory: string
  cloudOrigin: () => string | null
  fetch: typeof fetch
  prepareAgentDirectory?: (directory: string) => void
}) {
  const bootstrapKey = secret()
  const leases = new Map<string, Lease>()
  const metadataPath = join(options.userDataPath, 'hive-native', 'bridge.json')
  let closed = false
  let authority = ''
  const revoke = (key: string, lease: Lease) => {
    leases.delete(key)
    for (const controller of lease.controllers) {
      controller.abort()
    }
  }
  const valid = (lease: Lease, auth: HiveRuntimeCloudAuthorization | null) =>
    !closed &&
    lease.expiresAt > Date.now() &&
    auth &&
    auth.sessionExpiresAt > Date.now() &&
    auth.accountId === lease.accountId &&
    auth.authorityId === lease.authorityId &&
    options.cloudOrigin() === lease.origin
  const unsubscribe = options.account.subscribeRuntimeCloudAuthorization((auth) => {
    for (const [key, lease] of leases) {
      if (!valid(lease, auth)) {
        revoke(key, lease)
      }
    }
  })
  const sweep = setInterval(() => {
    const auth = options.account.getRuntimeCloudAuthorization()
    for (const [key, lease] of leases) {
      if (!valid(lease, auth)) {
        revoke(key, lease)
      }
    }
  }, 5000)
  sweep.unref()
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (
      closed ||
      request.headers.host !== authority ||
      request.headers.origin ||
      request.headers['sec-fetch-site']
    ) {
      error(response, 403, 'Native Hive client required')
      return
    }
    const authorization = request.headers.authorization ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      error(response, 401, 'Hive login required')
      return
    }
    if (request.url === '/launch' && request.method === 'POST' && equal(token, bootstrapKey)) {
      const auth = options.account.getRuntimeCloudAuthorization()
      const origin = options.cloudOrigin()
      if (!auth || auth.sessionExpiresAt <= Date.now() || !origin) {
        error(response, 401, 'Sign in to HiveCode first')
        return
      }
      if (leases.size >= 64) {
        error(response, 429, 'Too many active Hive agents')
        return
      }
      const catalog = await options.account.readAiModels()
      const lease: Lease = {
        accountId: auth.accountId,
        authorityId: auth.authorityId,
        origin,
        expiresAt: Date.now() + 20_000,
        controllers: new Set()
      }
      if (
        !valid(lease, options.account.getRuntimeCloudAuthorization()) ||
        catalog.accountId !== auth.accountId
      ) {
        error(response, 401, 'Hive login changed')
        return
      }
      if (!catalog.catalog.models.length) {
        error(response, 503, 'No authorized Hive models available')
        return
      }
      const key = secret()
      const agentDirectory = join(
        options.userDataPath,
        'hive-native',
        'accounts',
        createHash('sha256')
          .update(JSON.stringify([origin, auth.accountId, auth.authorityId]))
          .digest('hex')
      )
      await mkdir(agentDirectory, { recursive: true, mode: 0o700 })
      options.prepareAgentDirectory?.(agentDirectory)
      if (!valid(lease, options.account.getRuntimeCloudAuthorization())) {
        error(response, 401, 'Hive login changed')
        return
      }
      if (leases.size >= 64) {
        error(response, 429, 'Too many active Hive agents')
        return
      }
      leases.set(key, lease)
      send(response, 200, {
        token: key,
        baseUrl: `http://${authority}/v1`,
        models: catalog.catalog.models,
        selection: catalog.selection,
        runtimeDirectory: join(
          options.resourcesDirectory,
          'native-pi',
          `${process.platform}-${process.arch}`
        ),
        agentDirectory
      })
      return
    }
    const lease = leases.get(token)
    const auth = options.account.getRuntimeCloudAuthorization()
    if (!lease || !valid(lease, auth)) {
      if (lease) {
        revoke(token, lease)
      }
      error(response, 401, 'Hive session expired; sign in again')
      return
    }
    if (request.url === '/lease' && request.method === 'GET') {
      lease.expiresAt = Date.now() + 20_000
      send(response, 200, {})
      return
    }
    if (request.url === '/lease' && request.method === 'DELETE') {
      revoke(token, lease)
      send(response, 200, {})
      return
    }
    if (
      request.method !== 'POST' ||
      !['/v1/chat/completions', '/v1/responses'].includes(request.url ?? '')
    ) {
      error(response, 404, 'Unsupported Hive inference route')
      return
    }
    const controller = new AbortController()
    lease.controllers.add(controller)
    const abort = () => controller.abort()
    response.on('close', abort)
    const timeout = setTimeout(abort, 600_000)
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 16 * 1024 * 1024) {
          error(response, 413, 'Request too large')
          return
        }
        chunks.push(Buffer.from(chunk))
      }
      const currentAuth = options.account.getRuntimeCloudAuthorization()
      if (!valid(lease, currentAuth)) {
        error(response, 401, 'Hive login changed')
        return
      }
      const upstream = await options.fetch(`${lease.origin}/hive/v1/ai/native${request.url}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentAuth!.accessToken}`,
          'Content-Type': 'application/json'
        },
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
          if (!valid(lease, options.account.getRuntimeCloudAuthorization())) {
            controller.abort()
            response.destroy()
            break
          }
          if (!response.write(chunk)) {
            await once(response, 'drain', { signal: controller.signal })
          }
        }
      }
      response.end()
    } finally {
      clearTimeout(timeout)
      response.off('close', abort)
      lease.controllers.delete(controller)
    }
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (response.headersSent) {
        response.destroy()
      } else {
        error(response, 502, 'Hive gateway request failed')
      }
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Hive native listener unavailable')
    }
    authority = `127.0.0.1:${address.port}`
    await mkdir(join(options.userDataPath, 'hive-native'), { recursive: true, mode: 0o700 })
    await writeFile(
      metadataPath,
      JSON.stringify({ baseUrl: `http://${authority}`, token: bootstrapKey }),
      { mode: 0o600 }
    )
  } catch (cause) {
    clearInterval(sweep)
    unsubscribe()
    server.close()
    throw cause
  }
  return {
    async close() {
      closed = true
      clearInterval(sweep)
      unsubscribe()
      for (const [key, lease] of leases) {
        revoke(key, lease)
      }
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const metadata = await readFile(metadataPath, 'utf8').catch(() => '')
      let ownsMetadata = false
      try {
        ownsMetadata = JSON.parse(metadata).token === bootstrapKey
      } catch {
        /* Another process may replace metadata during shutdown. */
      }
      if (ownsMetadata) {
        await unlink(metadataPath).catch(() => undefined)
      }
    }
  }
}
