import type { HiveAccountSession } from './hive-account-session-store'
import { readHiveRuntimeCloudPresenceSession } from '../hive-runtime-cloud/hive-runtime-cloud-presence-session'

/** Host-owned session inputs; Cloud still verifies the token and live account authority. */
export function sameLiveHiveAccountLogin(
  before: HiveAccountSession,
  after: HiveAccountSession,
  now: number
): boolean {
  if (
    before.sessionProfile !== after.sessionProfile ||
    before.expiresAt <= now ||
    after.expiresAt <= now
  ) {
    return false
  }
  const read = (session: HiveAccountSession) =>
    readHiveRuntimeCloudPresenceSession(
      {
        accessToken: session.accessToken,
        accountId: session.account.accountId,
        authorityId: session.authorityId,
        sessionExpiresAt: session.sessionExpiresAt,
        sessionGeneration: session.generation
      },
      now
    )
  const previous = read(before),
    current = read(after)
  return Boolean(
    previous &&
    current &&
    previous.cloudSessionId === current.cloudSessionId &&
    previous.accountId === current.accountId &&
    previous.authorityId === current.authorityId
  )
}
