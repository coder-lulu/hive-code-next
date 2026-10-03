import type { HiveAccountSignOutResult } from '../../shared/hive-account'
import { signedOutState } from './hive-account-state'

export async function completeHiveAccountSignOut(input: {
  hasStoredSession: boolean
  revokeRemote: (() => Promise<void>) | null
  clearLocal: () => void
}): Promise<HiveAccountSignOutResult> {
  let localFailure: { error: unknown } | undefined
  try {
    input.clearLocal()
  } catch (error) {
    localFailure = { error }
  }
  let remoteRevoked = false
  try {
    if (input.hasStoredSession && input.revokeRemote) {
      await input.revokeRemote()
      remoteRevoked = true
    }
  } catch {
    remoteRevoked = false
  }
  if (localFailure) {
    throw localFailure.error
  }
  if (!input.hasStoredSession) {
    return { status: 'already-signed-out', state: signedOutState() }
  }
  return {
    status: remoteRevoked ? 'remote-and-local' : 'local-only',
    state: signedOutState()
  }
}
