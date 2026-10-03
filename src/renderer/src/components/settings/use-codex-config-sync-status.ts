import { useEffect, useState } from 'react'
import type { CodexConfigSyncStatus } from '../../../../shared/codex-config-sync-types'
import { watchCodexConfigSyncStatus } from './accounts-pane-config-sync'
import type { ProviderAccountRuntimeView } from './provider-account-visibility'

export function useCodexConfigSyncStatus(
  isRemoteAccountScope: boolean,
  runtime: ProviderAccountRuntimeView['runtime'],
  activeCodexAccountId: string | null,
  codexAccountsLoaded: boolean
): CodexConfigSyncStatus | null {
  const [status, setStatus] = useState<CodexConfigSyncStatus | null>(null)
  useEffect(() => {
    // The status describes the host's homes; WSL and remote accounts own different homes.
    if (isRemoteAccountScope || runtime !== 'host') {
      setStatus(null)
      return
    }
    // Retry temporary managed-home locks serially so a slower response cannot overwrite a
    // newer one. Selection changes restart the watcher for the newly active mirrored home.
    return watchCodexConfigSyncStatus(setStatus)
  }, [isRemoteAccountScope, runtime, activeCodexAccountId, codexAccountsLoaded])
  return status
}
