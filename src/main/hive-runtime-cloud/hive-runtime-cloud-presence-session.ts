import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-service'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-http-client'

export type HiveRuntimeCloudPresenceSession = HiveRuntimeCloudAuthorization &
  Readonly<{
    cloudSessionId: string
    accessExpiresAt: number
  }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAXIMUM_TIMER_DELAY_MS = 2_147_483_647

export type HiveRuntimeCloudPresenceSessionSource = () => HiveRuntimeCloudPresenceSession | null

export async function withHiveRuntimeCloudPresenceSession<T>(
  expected: HiveRuntimeCloudPresenceSession,
  current: HiveRuntimeCloudPresenceSessionSource,
  assertCurrent: () => void,
  operation: (authorization: HiveRuntimeCloudPresenceSession) => Promise<T>
): Promise<T> {
  const requireCurrent = () => {
    assertCurrent()
    const authorization = current()
    if (
      !authorization ||
      authorization.accountId !== expected.accountId ||
      authorization.authorityId !== expected.authorityId ||
      authorization.cloudSessionId !== expected.cloudSessionId
    ) {
      throw new Error('runtime_presence_session_changed')
    }
    return authorization
  }
  const sent = requireCurrent()
  try {
    return await operation(sent)
  } catch (error) {
    if (!(error instanceof HiveRuntimeCloudRequestError) || error.status !== 401) {
      throw error
    }
    const refreshed = requireCurrent()
    if (refreshed.accessToken === sent.accessToken) {
      throw error
    }
    return operation(refreshed)
  }
}

// Payload fields bind the request to its session; Cloud verifies the signature and live authority.
export function readHiveRuntimeCloudPresenceSession(
  authorization: HiveRuntimeCloudAuthorization | null,
  now: number
): HiveRuntimeCloudPresenceSession | null {
  if (
    !authorization ||
    authorization.sessionExpiresAt <= now ||
    authorization.accessToken.length > 16_384
  ) {
    return null
  }
  try {
    const segments = authorization.accessToken.split('.')
    if (segments.length !== 3 || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
      return null
    }
    const payload: unknown = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !('session_id' in payload) ||
      typeof payload.session_id !== 'string' ||
      !UUID.test(payload.session_id) ||
      !('sub' in payload) ||
      payload.sub !== authorization.accountId ||
      !('authority_id' in payload) ||
      payload.authority_id !== authorization.authorityId ||
      !('exp' in payload) ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= 0 ||
      payload.exp > 253_402_300_799 ||
      payload.exp * 1_000 <= now
    ) {
      return null
    }
    return Object.freeze({
      ...authorization,
      cloudSessionId: payload.session_id,
      accessExpiresAt: payload.exp * 1_000
    })
  } catch {
    return null
  }
}

export class HiveRuntimeCloudPresenceAccountSession {
  private session: HiveRuntimeCloudPresenceSession | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly now: () => number,
    private readonly onExpired: () => void
  ) {}

  current(): HiveRuntimeCloudPresenceSession | null {
    const session = this.session
    if (!session || Math.min(session.sessionExpiresAt, session.accessExpiresAt) > this.now()) {
      return session
    }
    this.clear()
    this.onExpired()
    return null
  }

  update(authorization: HiveRuntimeCloudAuthorization | null): boolean {
    const previous = this.current()
    this.clear()
    this.session = readHiveRuntimeCloudPresenceSession(authorization, this.now())
    const current = this.session
    if (current) {
      this.scheduleExpiry()
    }
    return (
      !previous ||
      !current ||
      previous.accountId !== current.accountId ||
      previous.authorityId !== current.authorityId ||
      previous.cloudSessionId !== current.cloudSessionId
    )
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    this.session = null
  }

  private scheduleExpiry(): void {
    if (!this.session) {
      return
    }
    const delay = Math.min(this.session.sessionExpiresAt, this.session.accessExpiresAt) - this.now()
    this.timer = setTimeout(
      () => {
        this.timer = null
        if (this.current()) {
          this.scheduleExpiry()
        }
      },
      Math.min(MAXIMUM_TIMER_DELAY_MS, Math.max(0, delay))
    )
    this.timer.unref?.()
  }
}
