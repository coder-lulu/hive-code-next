import { parseRemoteRuntimeJsonText } from '../../../shared/remote-runtime-request-frames'
import type { RuntimeCapability } from '../../../shared/protocol-version'
import { parseRuntimeClientCapabilities } from './runtime-client-capabilities'

export type E2EEAccountAuth = Readonly<{
  type: 'e2ee_auth'
  principalKind: 'account_runtime_session'
  ticketId: string
  ticketSecret: string
  clientCapabilities?: unknown
}>

export type E2EEAuthenticatedAccountSession = Readonly<{
  principalKind: 'account_runtime_session'
  runtimeSessionId: string
  expiresAt: number
}>

export type E2EEAccountBinding = Readonly<{ clientPublicKeyB64: string; transcriptHashB64: string }>

export type E2EEAccountSessionResolver = (
  auth: E2EEAccountAuth,
  signal: AbortSignal,
  binding: E2EEAccountBinding
) => Promise<E2EEAuthenticatedAccountSession | null>

export function parseE2EEAccountAuth(plaintext: string): E2EEAccountAuth | false | null {
  let value: unknown
  try {
    value = parseRemoteRuntimeJsonText(plaintext)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const auth = value as Record<string, unknown>
  if (auth.principalKind !== 'account_runtime_session') {
    return null
  }
  const required = ['type', 'principalKind', 'ticketId', 'ticketSecret']
  const allowed = [...required, 'clientCapabilities']
  if (
    required.some((key) => !Object.hasOwn(auth, key)) ||
    Object.keys(auth).some((key) => !allowed.includes(key)) ||
    auth.type !== 'e2ee_auth' ||
    typeof auth.ticketId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      auth.ticketId
    ) ||
    typeof auth.ticketSecret !== 'string' ||
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(auth.ticketSecret)
  ) {
    return false
  }
  return auth as E2EEAccountAuth
}

export class E2EEAccountAuthentication {
  private controller: AbortController | null = null
  private closed = false

  constructor(
    private readonly resolver: E2EEAccountSessionResolver | undefined,
    private readonly ready: (
      principal: E2EEAuthenticatedAccountSession,
      capabilities: readonly RuntimeCapability[]
    ) => void,
    private readonly reject: () => void
  ) {}

  get pending(): boolean {
    return this.controller !== null
  }

  async authenticate(auth: E2EEAccountAuth, binding: E2EEAccountBinding): Promise<void> {
    if (this.closed || this.controller || !this.resolver) {
      this.reject()
      return
    }
    const controller = new AbortController()
    this.controller = controller
    try {
      const principal = await this.resolver(auth, controller.signal, binding)
      if (controller.signal.aborted || this.closed) {
        return
      }
      this.controller = null
      if (
        !principal ||
        principal.principalKind !== 'account_runtime_session' ||
        !Number.isFinite(principal.expiresAt) ||
        principal.expiresAt <= Date.now()
      ) {
        this.reject()
        return
      }
      this.ready(principal, parseRuntimeClientCapabilities(auth.clientCapabilities))
    } catch {
      if (!controller.signal.aborted && !this.closed) {
        this.reject()
      }
    }
  }

  destroy(): void {
    this.closed = true
    this.controller?.abort()
    this.controller = null
  }
}
