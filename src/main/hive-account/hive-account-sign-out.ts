import type { HiveAccountSignOutResult } from '../../shared/hive-account'
import { signedOutState } from './hive-account-state'

export async function completeHiveAccountSignOut(input: {
  hasStoredSession: boolean
  revokeRemote: (() => Promise<void>) | null
  clearLocal: () => void
}): Promise<HiveAccountSignOutResult> {
  if (!input.hasStoredSession) {
    return { status: 'already-signed-out', state: signedOutState() }
  }
  let remoteRevoked = false
  try {
    if (input.revokeRemote) {
      await input.revokeRemote()
      remoteRevoked = true
    }
  } catch {
    remoteRevoked = false
  } finally {
    input.clearLocal()
  }
  return {
    status: remoteRevoked ? 'remote-and-local' : 'local-only',
    state: signedOutState()
  }
}
