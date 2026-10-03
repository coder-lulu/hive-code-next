import { Cloud, Laptop, Loader2, RefreshCw } from 'lucide-react'
import type { HiveAccountSettingsContentProps } from '../settings/HiveAccountSettingsContent'
import { HiveAccountNotice } from '../settings/HiveAccountSignedOutState'
import { resolveHiveAccountRuntimePresentation } from '../settings/hive-account-runtime-presentation'
import { isHiveRuntimeCrossDeviceConnectable } from '../../../../shared/hive-runtime-connectivity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export function MobileCloudConnection(props: HiveAccountSettingsContentProps): React.JSX.Element {
  const { state, directory, ownership, busy } = props
  const signedIn = state?.status === 'signed-in'
  const authorized =
    signedIn && state.errorCode !== 'session_expired' && state.errorCode !== 'session_rejected'
  const sameAccount = Boolean(
    state?.account?.accountId &&
    directory.accountId === state.account.accountId &&
    ownership.accountId === state.account.accountId &&
    directory.sessionGeneration !== null &&
    directory.sessionGeneration === ownership.sessionGeneration
  )
  const runtime = resolveHiveAccountRuntimePresentation(
    sameAccount ? directory : { ...directory, status: 'LOADING', items: [] },
    ownership,
    authorized
  )
  const entry = sameAccount
    ? (directory.items.find((item) => item.runtimeRecordId === ownership.runtimeRecordId) ?? null)
    : null
  const ready =
    authorized &&
    sameAccount &&
    directory.status === 'READY' &&
    ownership.relation === 'CLAIMED_BY_CURRENT' &&
    runtime.online &&
    isHiveRuntimeCrossDeviceConnectable(entry)

  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-center gap-2">
        <Cloud className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">
          {translate('phoneConnection.cloud', 'HiveCloud account')}
        </h2>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        {translate(
          'phoneConnection.cloudDescription',
          'Sign in on your computer and phone with the same HiveCloud account to connect across networks.'
        )}
      </p>
      <HiveAccountNotice {...props} />
      {!state ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {translate('auto.components.settings.orcaAccount.checking', 'Checking account status…')}
        </p>
      ) : !signedIn ? (
        <Button disabled={!props.canSignIn || busy !== null} onClick={props.onSignIn}>
          {busy === 'sign-in' ? <Loader2 className="animate-spin" /> : null}
          {translate('auto.components.settings.orcaAccount.signIn', 'Sign in to HiveCloud')}
        </Button>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 border-y border-border/60 py-4">
            <Laptop className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">
                {state.deviceLabel || translate('phoneConnection.thisComputer', 'This computer')}
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {state.account?.displayName || state.account?.accountId}
              </p>
            </div>
            <Badge variant="outline" role="status">
              {ready
                ? translate('phoneConnection.ready', 'Ready to connect')
                : runtime.online && sameAccount
                  ? translate('phoneConnection.relayUnavailable', 'Cloud access unavailable')
                  : runtime.label}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-muted-foreground" role="status">
            {ready
              ? translate(
                  'phoneConnection.cloudInstructions',
                  'On your phone, open Connect computer and select this computer from your account list. Keep HiveCode running on this computer.'
                )
              : runtime.online && sameAccount
                ? translate(
                    'phoneConnection.relayRequired',
                    'This computer is online, but cross-device access is not ready. Check the connection details and refresh the status.'
                  )
                : runtime.description}
          </p>
          {ownership.claimUserCode && sameAccount ? (
            <code role="status" className="block font-mono text-sm">
              {ownership.claimUserCode}
            </code>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {authorized && sameAccount && runtime.canClaim ? (
              <Button disabled={busy !== null} onClick={props.onClaimRuntime}>
                {busy === 'claim' ? <Loader2 className="animate-spin" /> : null}
                {translate('phoneConnection.linkComputer', 'Link this computer')}
              </Button>
            ) : null}
            <Button variant="outline" disabled={busy !== null} onClick={props.onRefresh}>
              <RefreshCw className={busy === 'refresh' ? 'animate-spin' : undefined} />
              {translate('phoneConnection.refresh', 'Refresh connection status')}
            </Button>
            <Button variant="ghost" onClick={props.onOpenRuntimeDetails}>
              {translate(
                'auto.components.settings.orcaAccount.viewConnectionDetails',
                'View connection details'
              )}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
