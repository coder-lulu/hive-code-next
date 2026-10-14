import { RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import type { SettingsHostScope } from './settings-host-scope'
import { useAppStore } from '@/store'
import {
  getLocalAgentPreflightContext,
  localPreflightContextKey
} from '@/lib/local-preflight-context'
import { useDetectedAgents, type AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'

export function AgentDetectionRefreshButton({ hostScope }: { hostScope: SettingsHostScope }) {
  const environmentId =
    hostScope.target.kind === 'environment' ? hostScope.target.environmentId : null
  const localContext = useAppStore((state) => getLocalAgentPreflightContext(state))
  const contextKey = localPreflightContextKey(localContext)
  const target = useMemo<AgentDetectionTarget | undefined>(
    () =>
      !hostScope.available
        ? undefined
        : environmentId
          ? { kind: 'runtime', environmentId }
          : { kind: 'local', contextKey },
    [hostScope.available, environmentId, contextKey]
  )
  const { refresh, isRefreshing } = useDetectedAgents(target)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2 shadow-none"
      disabled={!hostScope.available || isRefreshing}
      onClick={() => {
        if (hostScope.available) {
          void refresh()
        }
      }}
    >
      <RefreshCw className={cn('size-4', isRefreshing && 'animate-spin')} />
      {translate(
        isRefreshing ? 'agentsSettings.refreshing' : 'agentsSettings.refreshDetection',
        isRefreshing ? 'Refreshing…' : 'Refresh detection'
      )}
    </Button>
  )
}
