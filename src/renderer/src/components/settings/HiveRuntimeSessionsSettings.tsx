import { Globe2, KeyRound, Laptop, Loader2, RefreshCw, Smartphone } from 'lucide-react'
import type { HiveRuntimeSession } from '../../../../shared/hive-runtime-cloud'
import { useHiveRuntimeSessionPage } from './use-hive-runtime-session-page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { formatAccountAuthorization, sessionStatusLabel } from './hive-account-settings-view'

type CurrentDeviceSummary = {
  label: string
  platform: string
  profile: string
  authorizationExpiresAt: number | undefined
}

function sessionIcon(kind: HiveRuntimeSession['clientKind']): React.JSX.Element {
  if (kind === 'MOBILE') {
    return <Smartphone className="size-4" />
  }
  if (kind === 'WEB') {
    return <Globe2 className="size-4" />
  }
  return <Laptop className="size-4" />
}

function clientKindLabel(kind: HiveRuntimeSession['clientKind']): string {
  switch (kind) {
    case 'MOBILE':
      return translate('auto.components.settings.runtimeSessions.clientMobile', 'Mobile')
    case 'WEB':
      return translate('auto.components.settings.runtimeSessions.clientWeb', 'Web')
    case 'DESKTOP':
      return translate('auto.components.settings.runtimeSessions.clientDesktop', 'Desktop')
  }
}

function canRevoke(status: HiveRuntimeSession['status']): boolean {
  return status === 'PENDING_ACTIVATION' || status === 'ACTIVE'
}

function RuntimeSessionRow({
  session,
  onRevoke
}: {
  session: HiveRuntimeSession
  onRevoke: (session: HiveRuntimeSession) => void
}): React.JSX.Element {
  const label = session.clientLabel || clientKindLabel(session.clientKind)
  const active = session.status === 'ACTIVE'
  return (
    <div className="group flex min-h-12 items-center gap-3 px-4 py-1 transition-colors hover:bg-muted/45 [@media(max-height:950px)]:min-h-11">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {sessionIcon(session.clientKind)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{label}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {clientKindLabel(session.clientKind)} ·{' '}
          {translate('auto.components.settings.runtimeSessions.connectedAt', 'Connected')}{' '}
          {formatAccountAuthorization(session.createdAt, 'medium')} ·{' '}
          {translate('auto.components.settings.runtimeSessions.runtimeLabel', 'Runtime')}{' '}
          {session.runtimeRecordId.slice(0, 8)}
        </p>
      </div>
      <Badge
        variant="outline"
        className={cn(
          'rounded-md text-[10px] font-medium',
          active && 'border-status-success-border bg-status-success-background text-status-success'
        )}
      >
        {active ? <span className="size-1.5 rounded-full bg-status-success" /> : null}
        {sessionStatusLabel(session.status)}
      </Badge>
      {canRevoke(session.status) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onRevoke(session)}
          aria-label={`${translate('auto.components.settings.runtimeSessions.endSession', 'End session')} ${label}`}
        >
          {translate('auto.components.settings.runtimeSessions.endSession', 'End session')}
        </Button>
      ) : null}
    </div>
  )
}

export function HiveRuntimeSessionsSettings({
  currentDevice,
  activeTab,
  onActiveTabChange,
  onOpenConnectionHelp
}: {
  currentDevice: CurrentDeviceSummary
  activeTab: 'device' | 'runtime'
  onActiveTabChange: (tab: 'device' | 'runtime') => void
  onOpenConnectionHelp: () => void
}): React.JSX.Element {
  const {
    sessions,
    loading,
    error,
    target,
    setTarget,
    revoking,
    revoke,
    page,
    hasNext,
    refresh,
    retry,
    previous,
    next
  } = useHiveRuntimeSessionPage(activeTab === 'runtime')

  const targetLabel = target?.clientLabel || (target ? clientKindLabel(target.clientKind) : '')

  return (
    <section
      id="hive-account-sessions"
      aria-labelledby="hive-account-sessions-title"
      className="overflow-hidden rounded-xl border border-border/60 bg-card"
    >
      <h3
        id="hive-account-sessions-title"
        className="px-4 py-2 text-sm font-semibold [@media(max-height:950px)]:py-1.5"
      >
        {translate('auto.components.settings.runtimeSessions.sectionTitle', 'Devices & sessions')}
      </h3>
      <Tabs
        value={activeTab}
        onValueChange={(value) => onActiveTabChange(value as 'device' | 'runtime')}
        className="gap-0 border-t border-border/60"
      >
        <TabsList
          variant="line"
          className="h-10 w-full justify-start gap-5 border-b border-border/60 px-4"
        >
          <TabsTrigger value="device" className="h-10 flex-none px-0 text-xs">
            {translate(
              'auto.components.settings.runtimeSessions.currentDeviceTab',
              'Sign-in devices'
            )}{' '}
            <span className="text-muted-foreground">1</span>
          </TabsTrigger>
          <TabsTrigger value="runtime" className="h-10 flex-none px-0 text-xs">
            {translate(
              'auto.components.settings.runtimeSessions.runtimeAccessTab',
              'Runtime access sessions'
            )}{' '}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="device" className="m-0">
          <div className="flex min-h-12 items-center gap-3 px-4 py-1 [@media(max-height:950px)]:min-h-11">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Laptop className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{currentDevice.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {currentDevice.platform} ·{' '}
                {translate('auto.components.settings.runtimeSessions.thisDevice', 'This device')}
              </p>
            </div>
            <div className="text-right">
              <p className="flex items-center justify-end gap-1 text-[11px] font-medium">
                <KeyRound className="size-3 text-muted-foreground" /> {currentDevice.profile}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {currentDevice.authorizationExpiresAt
                  ? `${translate('auto.components.settings.runtimeSessions.authorizationExpires', 'Authorization expires')} ${formatAccountAuthorization(currentDevice.authorizationExpiresAt)}`
                  : translate(
                      'auto.components.settings.runtimeSessions.authorizationUnknown',
                      'Authorization expiry unavailable'
                    )}
              </p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="runtime" className="m-0">
          {error ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-3 border-b border-status-warning-border bg-status-warning-background px-4 py-2.5 text-xs text-status-warning"
            >
              <p className="min-w-0 flex-1">
                {translate(
                  'auto.components.settings.runtimeSessions.loadFailed',
                  'Runtime sessions could not be loaded. Local pairing is unaffected.'
                )}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10"
                disabled={loading || revoking}
                onClick={() => void retry()}
              >
                <RefreshCw className={loading ? 'animate-spin' : undefined} />
                {translate('auto.components.settings.runtimeSessions.retry', 'Retry')}
              </Button>
            </div>
          ) : null}

          {loading && sessions.length === 0 ? (
            <div
              aria-label={translate(
                'auto.components.settings.runtimeSessions.loading',
                'Loading Runtime sessions'
              )}
              className="space-y-px"
            >
              {[0, 1].map((index) => (
                <div
                  key={index}
                  className="flex min-h-12 animate-pulse items-center gap-3 border-b border-border/50 px-4 last:border-b-0 [@media(max-height:950px)]:min-h-11"
                >
                  <span className="size-8 rounded-md bg-muted" />
                  <span className="h-3 w-40 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : null}

          {!loading && !error && sessions.length === 0 ? (
            <div className="flex min-h-32 items-center gap-3 px-5 py-5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Globe2 className="size-4" />
              </span>
              <div>
                <p className="text-xs font-medium">
                  {translate(
                    'auto.components.settings.runtimeSessions.emptyTitle',
                    'No cross-device access sessions'
                  )}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {translate(
                    'auto.components.settings.runtimeSessions.emptyDescription',
                    'Sessions appear here after HiveCode Mobile, Web, or another desktop connects to this Runtime.'
                  )}
                </p>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="mt-0.5 h-10 px-0 text-xs"
                  onClick={onOpenConnectionHelp}
                >
                  {translate(
                    'auto.components.settings.runtimeSessions.learnHowToConnect',
                    'Learn how to connect'
                  )}
                </Button>
              </div>
            </div>
          ) : null}

          {sessions.length > 0 ? (
            <div className="max-h-80 divide-y divide-border/55 overflow-y-auto scrollbar-sleek">
              {sessions.map((session) => (
                <RuntimeSessionRow
                  key={session.managedSessionId}
                  session={session}
                  onRevoke={(session) => !loading && !revoking && setTarget(session)}
                />
              ))}
            </div>
          ) : null}

          <div
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border/55 px-4 py-1.5"
            aria-busy={loading}
          >
            <span role="status" className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.runtimeSessions.pageSummary',
                'Page {{page}} · {{count}} sessions on this page',
                { page, count: sessions.length }
              )}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={loading || revoking}
                onClick={() => void refresh()}
              >
                <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
                {translate('auto.components.settings.runtimeSessions.refresh', 'Refresh sessions')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={loading || revoking || page === 1}
                onClick={() => void previous()}
              >
                {translate('auto.components.settings.runtimeSessions.previousPage', 'Previous')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={loading || revoking || !hasNext}
                onClick={() => void next()}
              >
                {translate('auto.components.settings.runtimeSessions.nextPage', 'Next')}
              </Button>
            </div>
          </div>

          <p className="border-t border-border/55 px-4 py-1.5 text-[10px] text-muted-foreground [@media(max-height:950px)]:py-1">
            {translate(
              'auto.components.settings.runtimeSessions.authorizedOnly',
              'Runtime access connection history for this account, not chat sessions. Reconnects and separate channels create separate records.'
            )}
          </p>
        </TabsContent>
      </Tabs>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.settings.runtimeSessions.confirmTitle',
                'End this Runtime session?'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.settings.runtimeSessions.confirmDescription',
                'This connection will lose access to the Runtime. Local pairing and Runtime ownership are not changed.'
              )}
            </DialogDescription>
          </DialogHeader>
          {target ? (
            <div className="rounded-lg bg-muted/55 px-3 py-2.5 text-xs">
              <p className="font-medium">{targetLabel}</p>
              <p className="mt-1 leading-5 text-muted-foreground">
                {clientKindLabel(target.clientKind)} ·{' '}
                {translate('auto.components.settings.runtimeSessions.connectedAt', 'Connected')}{' '}
                {formatAccountAuthorization(target.createdAt, 'medium')}
                <br />
                {translate('auto.components.settings.runtimeSessions.runtimeLabel', 'Runtime')}{' '}
                {target.runtimeRecordId.slice(0, 8)}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              className="h-10"
              disabled={revoking}
              onClick={() => setTarget(null)}
            >
              {translate('auto.components.settings.runtimeSessions.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-10"
              disabled={revoking}
              onClick={() => void revoke()}
            >
              {revoking ? <Loader2 className="size-4 animate-spin" /> : null}
              {translate('auto.components.settings.runtimeSessions.confirm', 'End session')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
