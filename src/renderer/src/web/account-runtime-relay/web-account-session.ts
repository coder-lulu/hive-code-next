import { z } from 'zod'
import {
  acquireHiveAccountRelayMaterial,
  disposeHiveAccountRelayMaterial
} from '../../../../shared/hive-account-relay-material'
import { parseHiveRelayJson } from '../../../../shared/hive-relay-json'

class WebAccountRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number
  ) {
    super(
      status === 401 ? 'Account session expired. Sign in again.' : 'Account service unavailable'
    )
  }
}

const Runtime = z.object({
  runtimeRecordId: z.string().uuid(),
  resourceVersion: z.number().int().positive(),
  cloudDisplayName: z.string().nullable().optional(),
  deviceName: z.string().nullable().optional(),
  status: z.string(),
  connectionCapabilities: z.array(z.string()).optional(),
  projection: z
    .object({ connectionCapabilities: z.array(z.string()).optional() })
    .nullable()
    .optional()
})
export type WebAccountRuntime = z.infer<typeof Runtime>
export const WEB_ACCOUNT_LOGIN_PATH = '/login?redirect=%2Fruntime%2F'

export function requestedWebRuntime(search: string): string | null {
  const values = new URLSearchParams(search).getAll('runtime')
  if (values.length === 0) {
    return null
  }
  if (values.length !== 1 || !z.string().uuid().safeParse(values[0]).success) {
    throw new Error('无效的电脑连接地址，请从控制台重新打开。')
  }
  return values[0]!.toLowerCase()
}

export function canConnectWebRuntime(runtime: WebAccountRuntime): boolean {
  const capabilities =
    runtime.projection?.connectionCapabilities ?? runtime.connectionCapabilities ?? []
  return (
    runtime.status === 'CLAIMED' &&
    capabilities.includes('hive-relay') &&
    capabilities.includes('ticket-connect-v2')
  )
}

export class WebAccountSession {
  private csrf = ''
  private generation = 0
  private controller = new AbortController()

  constructor(
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly origin: string = window.location.origin
  ) {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
      throw new Error('Account connection requires HTTPS')
    }
  }

  async restore(): Promise<boolean> {
    const generation = this.generation
    const { value } = await this.request('/auth/session')
    const session = z
      .object({ authenticated: z.boolean(), csrfToken: z.string().min(1).max(4096).optional() })
      .parse(value)
    if (generation !== this.generation) {
      throw new Error('Account session changed')
    }
    if (this.csrf && session.csrfToken !== this.csrf) {
      this.close()
      return false
    }
    this.csrf = session.authenticated ? (session.csrfToken ?? '') : ''
    return session.authenticated && !!this.csrf
  }

  async runtimes(
    cursor?: string
  ): Promise<{ items: WebAccountRuntime[]; nextCursor: string | null }> {
    const query = new URLSearchParams({ limit: '50' })
    if (cursor) {
      query.set('cursor', cursor)
    }
    const { value, headers } = await this.request(`/runtimes?${query}`)
    const raw = z
      .union([
        z.array(z.unknown()),
        z.object({ items: z.array(z.unknown()) }),
        z.object({ data: z.array(z.unknown()) })
      ])
      .parse(value)
    const items = Array.isArray(raw) ? raw : 'items' in raw ? raw.items : raw.data
    return {
      items: z.array(Runtime).max(50).parse(items),
      nextCursor: headers.get('X-Hive-Next-Cursor')
    }
  }

  async material(runtime: WebAccountRuntime) {
    if (!this.csrf || this.controller.signal.aborted) {
      throw new Error('Account sign-in required')
    }
    const generation = this.generation
    const material = await acquireHiveAccountRelayMaterial({
      clientKind: 'WEB',
      expectedResourceVersion: runtime.resourceVersion,
      createIntent: async (body) =>
        (
          await this.request(
            `/runtimes/${encodeURIComponent(runtime.runtimeRecordId)}/connection-intents`,
            body
          )
        ).value
    })
    if (this.controller.signal.aborted || this.generation !== generation) {
      disposeHiveAccountRelayMaterial(material)
      throw new Error('Account session changed')
    }
    return material
  }

  async runtime(runtimeRecordId: string): Promise<WebAccountRuntime> {
    const id = z.string().uuid().parse(runtimeRecordId)
    const { value } = await this.request(`/runtimes/${encodeURIComponent(id)}`)
    const runtime = Runtime.parse(value)
    if (runtime.runtimeRecordId !== id) {
      throw new Error('Unexpected Runtime identity')
    }
    return runtime
  }

  close(): void {
    this.generation++
    this.csrf = ''
    this.controller.abort()
  }

  async signOut(): Promise<void> {
    try {
      await this.request('/auth/logout', {})
    } finally {
      this.close()
    }
  }

  async loginCapabilities() {
    const { value } = await this.request('/auth/login-capabilities')
    return z
      .object({
        contractRevision: z.literal('hive-login-capabilities-v1'),
        clientId: z.string().min(1),
        defaultMethod: z.literal('phone_sms'),
        providers: z.array(
          z.object({ id: z.enum(['github', 'wechat', 'qq']), authorizationPath: z.string().min(1) })
        )
      })
      .parse(value)
  }

  private async request(
    path: string,
    body?: unknown
  ): Promise<{ value: unknown; headers: Headers }> {
    const timeout = AbortSignal.timeout(15_000)
    const response = await this.fetchImpl(`${this.origin}/bff/user${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([this.controller.signal, timeout]),
      headers: {
        Accept: 'application/json',
        ...(body === undefined
          ? {}
          : {
              'Content-Type': 'application/json',
              'X-CSRF-Token': this.csrf
            })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    if (response.status === 204 && !response.redirected) {
      return { value: undefined, headers: response.headers }
    }
    if (
      !response.ok ||
      response.redirected ||
      !response.headers.get('content-type')?.startsWith('application/json')
    ) {
      await response.body?.cancel()
      throw new WebAccountRequestError(
        response.status,
        Math.min(60_000, Math.max(0, Number(response.headers.get('Retry-After') ?? 0) * 1000))
      )
    }
    if (!response.body) {
      throw new Error('Account service returned an empty response')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let size = 0
    let text = ''
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) {
          break
        }
        size += part.value.byteLength
        if (size > 1024 * 1024) {
          throw new Error('Account response exceeds limit')
        }
        text += decoder.decode(part.value, { stream: true })
      }
      text += decoder.decode()
      return { value: parseHiveRelayJson(text, 1024 * 1024), headers: response.headers }
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    } finally {
      reader.releaseLock()
    }
  }
}
