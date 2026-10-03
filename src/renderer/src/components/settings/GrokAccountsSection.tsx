import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import { Button } from '../ui/button'
import type { GrokAccountStatus } from '../../../../shared/rate-limit-types'

const GROK_CLI_DOCS_URL = 'https://docs.x.ai/build/overview'

export function GrokAccountsSection(): React.JSX.Element {
  const refreshGrokRateLimits = useAppStore((state) => state.refreshGrokRateLimits)
  const grokUsage = useAppStore((state) => state.rateLimits.grok)
  const [status, setStatus] = useState<GrokAccountStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.api.grokAccounts.getStatus())
    } catch (error) {
      setStatus({
        signedIn: false,
        email: null,
        teamId: null,
        tokenFresh: false,
        error: error instanceof Error ? error.message : 'Unable to read Grok sign-in'
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus, grokUsage?.updatedAt])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await refreshGrokRateLimits()
      await loadStatus()
    } finally {
      setRefreshing(false)
    }
  }

  const usageWindow = grokUsage?.weekly ?? grokUsage?.monthly ?? null
  const statusCopy = loading
    ? translate('auto.components.settings.AccountsPane.loading', 'Loading…')
    : status?.error
      ? translate('auto.components.settings.AccountsPane.readFailed', 'Read failed')
      : status?.signedIn
        ? status.tokenFresh
          ? status.email || translate('auto.components.settings.AccountsPane.signedIn', 'Signed in')
          : translate('auto.components.settings.AccountsPane.sessionExpired', 'Session expired')
        : translate('auto.components.settings.AccountsPane.notSignedIn', 'Not signed in')
  const unavailableReason =
    status?.signedIn && !usageWindow && grokUsage?.status === 'unavailable' ? grokUsage.error : null

  return (
    <div
      id="accounts-grok"
      className="grid min-h-14 grid-cols-[minmax(9rem,1fr)_minmax(12rem,1.25fr)_auto] items-center gap-4 px-5 py-3 max-md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <AgentIcon agent="grok" size={22} />
        <span className="truncate text-sm font-semibold">
          {translate('auto.components.settings.GrokAccountsSection.a1b2c3d4e5', 'Grok')}
        </span>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground max-md:hidden">
        {translate('auto.components.settings.AccountsPane.grokScope', 'Local CLI · Usage lookup')}
      </div>
      <div className="flex items-center justify-end gap-2">
        {status?.signedIn && !status.tokenFresh ? (
          <span className="sr-only">
            {translate(
              'auto.components.settings.GrokAccountsSection.f08c41de73',
              'Session expired — run grok on the computer running Orca and wait for it to start. If prompted, complete sign-in, then click Refresh usage. No chat message is needed.'
            )}
          </span>
        ) : null}
        {unavailableReason ? <span className="sr-only">{unavailableReason}</span> : null}
        <span
          className={
            status?.error
              ? 'flex items-center gap-1.5 text-xs text-destructive'
              : 'max-w-40 truncate text-xs text-muted-foreground'
          }
          title={status?.error || undefined}
        >
          {status?.error ? <TriangleAlert className="size-3.5 shrink-0" /> : null}
          {usageWindow && !status?.error
            ? `${Math.round(usageWindow.usedPercent)}% · ${statusCopy}`
            : statusCopy}
        </span>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {status?.error
            ? translate('auto.components.settings.AccountsPane.retry', 'Retry')
            : translate('auto.components.settings.GrokAccountsSection.3325d996cb', 'Refresh usage')}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          asChild
          aria-label={translate(
            'auto.components.settings.GrokAccountsSection.0d8e77bc40',
            'Grok CLI docs'
          )}
        >
          <a href={GROK_CLI_DOCS_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </div>
    </div>
  )
}
