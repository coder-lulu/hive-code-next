import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { HiveAccountState } from '../../../../shared/hive-account'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'

type Props = {
  state: HiveAccountState | null
  busy: 'sign-in' | 'refresh' | 'sign-out' | 'claim' | null
  canSignIn: boolean
  onSignIn: () => void
  onRefresh: () => void
}

function accountErrorCopy(state: HiveAccountState): string | null {
  switch (state.errorCode) {
    case 'secure_storage_unavailable':
      return translate(
        'auto.components.settings.orcaAccount.secureStorageUnavailableNotice',
        'System secure storage is unavailable, so HiveCloud credentials cannot be saved safely.'
      )
    case 'credential_unreadable':
      return translate(
        'auto.components.settings.orcaAccount.credentialUnreadableNotice',
        'The saved HiveCloud credential cannot be read from system secure storage.'
      )
    case 'session_expired':
    case 'session_rejected':
      return translate(
        'auto.components.settings.orcaAccount.sessionExpiredNotice',
        'Your sign-in authorization expired. Sign in to HiveCloud again.'
      )
    case 'network_unavailable':
      return translate(
        'auto.components.settings.orcaAccount.networkUnavailableNotice',
        'HiveCloud cannot be reached right now. Local work is unaffected.'
      )
    case 'server_unavailable':
      return translate(
        'auto.components.settings.orcaAccount.serverUnavailableNotice',
        'HiveCloud is temporarily unavailable. Local work is unaffected.'
      )
    case 'authorization_cancelled':
    case 'authorization_timeout':
    case 'authorization_failed':
      return translate(
        'auto.components.settings.orcaAccount.authorizationFailedNotice',
        'HiveCloud sign-in did not complete. Try again when you are ready.'
      )
    case undefined:
      return null
  }
}

export function HiveAccountNotice({
  state,
  busy,
  onSignIn,
  onRefresh
}: Props): React.JSX.Element | null {
  const [helpOpen, setHelpOpen] = useState(false)
  if (!state) {
    return null
  }
  const copy = accountErrorCopy(state)
  if (!copy) {
    return null
  }
  const needsSignIn =
    state.errorCode === 'session_expired' || state.errorCode === 'session_rejected'
  const retryable =
    state.errorCode === 'network_unavailable' ||
    state.errorCode === 'server_unavailable' ||
    state.errorCode === 'secure_storage_unavailable' ||
    state.errorCode === 'credential_unreadable'
  const secureStorageIssue =
    state.errorCode === 'secure_storage_unavailable' || state.errorCode === 'credential_unreadable'
  return (
    <>
      <div
        role={secureStorageIssue ? 'alert' : 'status'}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-status-warning-border bg-status-warning-background px-4 py-2.5 text-xs text-status-warning"
      >
        <AlertTriangle className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 leading-5">{copy}</p>
        {secureStorageIssue ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10"
            onClick={() => setHelpOpen(true)}
          >
            {translate(
              'auto.components.settings.orcaAccount.viewSecureStorageHelp',
              'View troubleshooting'
            )}
          </Button>
        ) : null}
        {needsSignIn ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10"
            disabled={busy !== null}
            onClick={onSignIn}
          >
            {translate('auto.components.settings.orcaAccount.signInAgain', 'Sign in again')}
          </Button>
        ) : retryable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10"
            disabled={busy !== null}
            onClick={onRefresh}
          >
            <RefreshCw className={busy === 'refresh' ? 'animate-spin' : undefined} />
            {secureStorageIssue
              ? translate('auto.components.settings.orcaAccount.recheckSecureStorage', 'Recheck')
              : translate('auto.components.settings.orcaAccount.retryConnection', 'Retry')}
          </Button>
        ) : null}
      </div>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.settings.orcaAccount.secureStorageHelpTitle',
                'Restore system secure storage'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.settings.orcaAccount.secureStorageHelpDescription',
                "Unlock or enable your operating system's credential manager, then restart HiveCode and recheck. HiveCloud sign-in stays disabled until credentials can be stored securely."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="h-10" size="sm" onClick={() => setHelpOpen(false)}>
              {translate('auto.components.settings.orcaAccount.gotIt', 'Got it')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function HiveAccountLoading(): React.JSX.Element {
  return (
    <div
      aria-label={translate(
        'auto.components.settings.orcaAccount.checking',
        'Checking account status…'
      )}
      className="space-y-5"
    >
      <div className="h-24 animate-pulse rounded-xl bg-muted/70" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-52 animate-pulse rounded-xl bg-muted/55" />
        <div className="h-52 animate-pulse rounded-xl bg-muted/55" />
      </div>
      <div className="h-48 animate-pulse rounded-xl bg-muted/45" />
    </div>
  )
}

export function HiveAccountSignedOutState(props: Props): React.JSX.Element {
  const { state, busy, canSignIn, onSignIn } = props
  return (
    <div className="space-y-5">
      <HiveAccountNotice {...props} />
      <div className="rounded-xl border border-border/60 bg-card px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
            H
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {translate('auto.components.settings.orcaAccount.localMode', 'Local mode')}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {state?.status === 'unconfigured' && state.setupMessage
                ? state.setupMessage
                : translate(
                    'auto.components.settings.orcaAccount.localModeDescription',
                    'HiveCloud is not connected. Local projects, terminals, and agents remain available without signing in.'
                  )}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-10"
            disabled={!canSignIn || busy !== null}
            onClick={onSignIn}
          >
            {busy === 'sign-in'
              ? translate('auto.components.settings.orcaAccount.signingIn', 'Signing in…')
              : translate('auto.components.settings.orcaAccount.signIn', 'Sign in to HiveCloud')}
          </Button>
        </div>
      </div>
    </div>
  )
}
