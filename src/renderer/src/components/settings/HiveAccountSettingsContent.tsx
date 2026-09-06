import { Copy, Ellipsis, Laptop, LogOut, RefreshCw, Server, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { HiveAccountState } from '../../../../shared/hive-account'
import type {
  HiveAccountRuntimeDirectoryState,
  HiveLocalRuntimeOwnershipState
} from '../../../../shared/hive-runtime-cloud'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { HiveRuntimeSessionsSettings } from './HiveRuntimeSessionsSettings'
import { HiveAccountDetailRow } from './HiveAccountDetailRow'
import { HiveAccountSecuritySection } from './HiveAccountSecuritySection'
import {
  HiveAccountLoading,
  HiveAccountNotice,
  HiveAccountSignedOutState
} from './HiveAccountSignedOutState'
import { resolveHiveAccountRuntimePresentation } from './hive-account-runtime-presentation'
import {
  accountPlatformLabel,
  accountRuntimeToneClass,
  accountSessionProfileLabel,
  formatAccountAuthorization,
  type HiveAccountPlatformInfo
} from './hive-account-settings-view'

export type { HiveAccountPlatformInfo } from './hive-account-settings-view'

type Props = {
  state: HiveAccountState | null
  directory: HiveAccountRuntimeDirectoryState
  ownership: HiveLocalRuntimeOwnershipState
  platformInfo: HiveAccountPlatformInfo | null
  busy: 'sign-in' | 'refresh' | 'sign-out' | 'claim' | null
  canSignIn: boolean
  onSignIn: () => void
  onRefresh: () => void
  onClaimRuntime: () => void
  onOpenRuntimeDetails: () => void
  onSignOut: () => void
}

export function HiveAccountSettingsContent(props: Props): React.JSX.Element {
  const [sessionsTab, setSessionsTab] = useState<'device' | 'runtime'>('runtime')
  const { state, directory, ownership, platformInfo, busy } = props
  if (!state) {
    return <HiveAccountLoading />
  }
  const connected = state.status === 'signed-in'
  if (!connected) {
    return <HiveAccountSignedOutState {...props} />
  }

  const accountAuthorized =
    state.errorCode !== 'session_expired' && state.errorCode !== 'session_rejected'
  const accountAuthorizationLabel =
    state.errorCode === 'session_expired'
      ? translate(
          'auto.components.settings.orcaAccount.authorizationExpired',
          'Authorization expired'
        )
      : state.errorCode === 'session_rejected'
        ? translate('auto.components.settings.orcaAccount.signInRequired', 'Sign-in required')
        : translate('auto.components.settings.orcaAccount.signedIn', 'Signed in')
  const runtime = resolveHiveAccountRuntimePresentation(directory, ownership, accountAuthorized)
  const displayName = state.account?.displayName || state.account?.accountId || 'HiveCloud'
  const initial = Array.from(displayName.trim())[0]?.toLocaleUpperCase() ?? 'H'
  const deviceLabel =
    state.deviceLabel ?? translate('auto.components.settings.orcaAccount.defaultDevice', 'Desktop')
  const profile = accountSessionProfileLabel(state.sessionProfile)
  const system = accountPlatformLabel(platformInfo)
  const credentialProtection =
    state.persistence === 'encrypted'
      ? translate(
          'auto.components.settings.orcaAccount.systemSecureStorage',
          'System secure storage'
        )
      : translate(
          'auto.components.settings.orcaAccount.memoryOnlyCredential',
          'Current session only'
        )

  const copyAccount = (): void => {
    const text = state.account?.accountId
      ? `${displayName}\n${state.account.accountId}`
      : displayName
    void navigator.clipboard.writeText(text)
  }

  return (
    <div className="space-y-5 [@media(max-height:950px)]:space-y-4">
      <HiveAccountNotice {...props} />

      <section
        aria-label={translate(
          'auto.components.settings.orcaAccount.accountOverview',
          'Account overview'
        )}
        className="relative rounded-xl border border-border/60 bg-card px-5 py-3.5 sm:px-6 [@media(max-height:950px)]:py-3"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3.5 pr-9">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-foreground">
              {initial}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {translate('auto.components.settings.orcaAccount.account', 'HiveCloud account')}
              </p>
              <p
                className={cn(
                  'mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground',
                  !accountAuthorized && 'text-status-warning'
                )}
              >
                <ShieldCheck className="size-3.5" />
                {accountAuthorizationLabel}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 pt-4 lg:w-[410px] lg:border-t-0 lg:pt-0">
            <div className="px-3 first:pl-0 lg:first:pl-3">
              <p className="text-[11px] text-muted-foreground">
                {translate('auto.components.settings.orcaAccount.accountStatus', 'Account')}
              </p>
              <p
                className={cn(
                  'mt-1 text-xs font-medium',
                  !accountAuthorized && 'text-status-warning'
                )}
              >
                {accountAuthorizationLabel}
              </p>
            </div>
            <div className="px-3">
              <p className="text-[11px] text-muted-foreground">
                {translate('auto.components.settings.orcaAccount.currentDevice', 'Current device')}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium">
                <ShieldCheck className="size-3.5 text-muted-foreground" /> {profile}
              </p>
            </div>
            <div className="px-3">
              <p className="text-[11px] text-muted-foreground">
                {translate('auto.components.settings.orcaAccount.runtimeLabel', 'Runtime')}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    accountRuntimeToneClass(runtime.tone)
                  )}
                />
                {runtime.label}
              </p>
            </div>
          </div>
        </div>

        <DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 size-10"
                    aria-label={translate(
                      'auto.components.settings.orcaAccount.moreActions',
                      'More account actions'
                    )}
                  >
                    <Ellipsis className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="left">
                {translate(
                  'auto.components.settings.orcaAccount.moreActions',
                  'More account actions'
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="h-10" onSelect={copyAccount}>
              <Copy />
              {translate(
                'auto.components.settings.orcaAccount.copyAccountInfo',
                'Copy account info'
              )}
            </DropdownMenuItem>
            <DropdownMenuItem className="h-10" disabled={busy !== null} onSelect={props.onRefresh}>
              <RefreshCw className={busy === 'refresh' ? 'animate-spin' : undefined} />
              {translate(
                'auto.components.settings.orcaAccount.checkConnection',
                'Check connection'
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="h-10" variant="destructive" onSelect={props.onSignOut}>
              <LogOut />
              {translate('auto.components.settings.orcaAccount.signOut', 'Sign out')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-border/60 bg-card px-5 py-3.5 [@media(max-height:950px)]:py-3">
          <h3 className="text-sm font-semibold">
            {translate('auto.components.settings.orcaAccount.currentDevice', 'Current device')}
          </h3>
          <div className="mt-2 flex min-h-10 items-center gap-3 [@media(max-height:950px)]:min-h-9">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Laptop className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{deviceLabel}</p>
              <p className="truncate text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.orcaAccount.desktopProductLabel',
                  '{{system}} · HiveCode Desktop',
                  { system }
                )}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant="outline" className="rounded-md text-[10px] font-medium">
                {translate('auto.components.settings.orcaAccount.thisDevice', 'This device')}
              </Badge>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <ShieldCheck className="size-3" /> {profile}
              </span>
            </div>
          </div>
          <div className="mt-2">
            <HiveAccountDetailRow
              label={translate(
                'auto.components.settings.orcaAccount.loginAuthorization',
                'Sign-in authorization'
              )}
              value={formatAccountAuthorization(state.sessionExpiresAt)}
            />
            <HiveAccountDetailRow
              label={translate(
                'auto.components.settings.orcaAccount.credentialProtection',
                'Credential protection'
              )}
              value={credentialProtection}
            />
          </div>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mt-0.5 h-10 px-0 text-xs"
            onClick={() => {
              setSessionsTab('device')
              requestAnimationFrame(() =>
                document
                  .getElementById('hive-account-sessions')
                  ?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
              )
            }}
          >
            {translate('auto.components.settings.orcaAccount.manageDevices', 'Manage devices')}
          </Button>
        </section>

        <section className="rounded-xl border border-border/60 bg-card px-5 py-3.5 [@media(max-height:950px)]:py-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {translate(
                'auto.components.settings.orcaAccount.runtimeConnection',
                'Runtime connection'
              )}
            </h3>
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <span className={cn('size-2 rounded-full', accountRuntimeToneClass(runtime.tone))} />
              {runtime.label}
            </span>
          </div>
          <div className="mt-2 flex min-h-10 items-center gap-3 [@media(max-height:950px)]:min-h-9">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Server className="size-5" />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{runtime.description}</p>
          </div>
          <div className="mt-2">
            <HiveAccountDetailRow
              label={translate(
                'auto.components.settings.orcaAccount.connectionStatus',
                'Connection status'
              )}
              value={runtime.connectionStatus}
            />
            <HiveAccountDetailRow
              label={translate(
                'auto.components.settings.orcaAccount.lastHeartbeat',
                'Last heartbeat'
              )}
              value={runtime.lastHeartbeat}
            />
            <HiveAccountDetailRow
              label={translate(
                'auto.components.settings.orcaAccount.remoteAccess',
                'Cross-device access'
              )}
              value={runtime.remoteAccess}
            />
          </div>
          {ownership.claimUserCode ? (
            <code className="font-mono text-sm" role="status">
              {ownership.claimUserCode}
            </code>
          ) : null}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-4">
            {runtime.canClaim || runtime.canRetry ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-10 px-0 text-xs"
                disabled={busy !== null}
                onClick={runtime.canClaim ? props.onClaimRuntime : props.onRefresh}
              >
                {runtime.canClaim
                  ? translate(
                      'auto.components.settings.orcaAccount.claimRuntime',
                      'Claim this Runtime'
                    )
                  : translate(
                      'auto.components.settings.orcaAccount.retryConnection',
                      'Retry connection'
                    )}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-10 px-0 text-xs"
              onClick={props.onOpenRuntimeDetails}
            >
              {translate(
                'auto.components.settings.orcaAccount.viewConnectionDetails',
                'View connection details'
              )}
            </Button>
          </div>
        </section>
      </div>

      <HiveRuntimeSessionsSettings
        key={`${state.authorityId}:${state.account?.accountId}:${directory.sessionGeneration}`}
        currentDevice={{
          label: deviceLabel,
          platform: system,
          profile,
          authorizationExpiresAt: state.sessionExpiresAt
        }}
        activeTab={sessionsTab}
        onActiveTabChange={setSessionsTab}
        onOpenConnectionHelp={props.onOpenRuntimeDetails}
      />

      <HiveAccountSecuritySection
        credentialProtection={credentialProtection}
        busy={busy !== null}
        onSignOut={props.onSignOut}
      />
    </div>
  )
}
