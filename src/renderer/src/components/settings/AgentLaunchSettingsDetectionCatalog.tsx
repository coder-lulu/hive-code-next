import type { ComponentProps } from 'react'
import { AgentDetectionCatalog } from './AgentDetectionCatalog'
import type { useAgentVersions } from './use-agent-versions'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'

export function AgentLaunchSettingsDetectionCatalog({
  versions,
  ...catalog
}: ComponentProps<typeof AgentDetectionCatalog> & {
  versions: Pick<ReturnType<typeof useAgentVersions>, 'snapshots' | 'checkLatest'>
}) {
  return (
    <>
      <Button
        variant="outline"
        disabled={Object.values(versions.snapshots).some((snapshot) => snapshot.latestLoading)}
        onClick={() => void versions.checkLatest()}
      >
        {translate('agentsSettings.checkUpdates', 'Check for updates')}
      </Button>
      <AgentDetectionCatalog {...catalog} />
    </>
  )
}
