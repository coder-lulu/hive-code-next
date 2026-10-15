import { useAccountRuntimeDirectory } from '../runtime-directory/account-runtime-directory-provider'
import { useAccountVisibleHostCatalog } from '../runtime-directory/use-account-visible-host-catalog'
import { resolveMobileTaskRuntimeState } from './mobile-task-runtime-state'

export function useMobileTaskRuntimeState(
  hostId: string,
  input: Parameters<typeof resolveMobileTaskRuntimeState>[0]
) {
  const { state: directory } = useAccountRuntimeDirectory()
  const { catalog, loaded } = useAccountVisibleHostCatalog()
  const runtime = catalog.find((entry) => entry.id === hostId)
  return resolveMobileTaskRuntimeState({
    ...input,
    accountPresence: runtime?.accountPresence,
    credentialStatus: runtime?.credentialStatus,
    catalogLoading: !loaded || (!runtime && directory.status === 'loading')
  })
}
