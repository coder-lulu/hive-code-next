import { RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { useDetectedAgents, type AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'

export function AgentDetectionRefreshButton({ settings }: { settings: GlobalSettings }) {
  const environmentId = settings.activeRuntimeEnvironmentId?.trim() || null
  const target = useMemo<AgentDetectionTarget>(
    () => (environmentId ? { kind: 'runtime', environmentId } : { kind: 'local' }),
    [environmentId]
  )
  const { refresh, isRefreshing } = useDetectedAgents(target)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2 shadow-none"
      disabled={isRefreshing}
      onClick={() => void refresh()}
    >
      <RefreshCw className={cn('size-4', isRefreshing && 'animate-spin')} />
      {translate(
        isRefreshing ? 'agentsSettings.refreshing' : 'agentsSettings.refreshDetection',
        isRefreshing ? 'Refreshing…' : 'Refresh detection'
      )}
    </Button>
  )
}
