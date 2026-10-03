import { parseExecutionHostId } from '../../../../shared/execution-host'
import { translate } from '@/i18n/i18n'
import { runtimeHostConnectionStateForEntry } from '@/runtime/runtime-host-connection-state'
import type { RuntimeEnvironmentStatus } from '@/store/slices/runtime-status-types'

export function getDesktopHomeWebLaunchIssue(
  executionHostId: string | undefined,
  statuses: ReadonlyMap<string, RuntimeEnvironmentStatus>
): string | null {
  const host = parseExecutionHostId(executionHostId)
  if (host?.kind !== 'runtime') {
    return translate(
      'components.desktopHome.composer.hostWorkspaceRequired',
      'Select a connected Host workspace to start a task in the browser.'
    )
  }
  if (runtimeHostConnectionStateForEntry(statuses.get(host.environmentId)) !== 'connected') {
    return translate(
      'components.desktopHome.composer.hostWorkspaceUnavailable',
      'This workspace’s Host is unavailable. Reconnect it before starting a task.'
    )
  }
  return null
}
