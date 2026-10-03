import type { MobileSession } from '../auth/mobile-sms-auth'
import type { AccountRuntimeDirectoryScope } from './account-runtime-directory-types'

export function accountRuntimeScopeOf(session: MobileSession): AccountRuntimeDirectoryScope {
  return { authorityId: session.authorityId, accountId: session.account.accountId }
}

export function mobileSessionMatchesDirectoryScope(
  session: MobileSession | null,
  scope: AccountRuntimeDirectoryScope
): boolean {
  return session?.authorityId === scope.authorityId && session.account.accountId === scope.accountId
}

export function mobileSessionMatchesOperationScope(
  current: MobileSession | null,
  requested: MobileSession
): boolean {
  return Boolean(
    current &&
    current.authorityId === requested.authorityId &&
    current.account.accountId === requested.account.accountId &&
    current.sessionExpiresAt === requested.sessionExpiresAt
  )
}

export async function runCurrentAccountSessionOperation<T>(
  requestedSession: MobileSession,
  getCurrentSession: () => MobileSession | null,
  operation: (session: MobileSession) => Promise<T>
): Promise<T> {
  const result = await operation(requestedSession)
  if (!mobileSessionMatchesOperationScope(getCurrentSession(), requestedSession)) {
    throw new Error('mobile_session_required')
  }
  return result
}
