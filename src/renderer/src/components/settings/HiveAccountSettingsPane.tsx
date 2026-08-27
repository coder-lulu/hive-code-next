import { useEffect, useState } from 'react'
import { Check, CircleUserRound, KeyRound, Laptop, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { HiveAccountErrorCode, HiveAccountState } from '../../../../shared/hive-account'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { HiveAccountSignOutConfirmDialog } from './HiveAccountSignOutConfirmDialog'
import { HiveAccountSignInConfirmDialog } from './HiveAccountSignInConfirmDialog'

function errorCopy(error: HiveAccountErrorCode | undefined): string {
  switch (error) {
    case 'secure_storage_unavailable':
      return translate(
        'auto.components.settings.orcaAccount.secureStorageUnavailable',
        'Cloud sign-in is disabled because operating-system secure storage is unavailable.'
      )
    case 'credential_unreadable':
      return translate(
        'auto.components.settings.orcaAccount.credentialUnreadable',
        'The encrypted account credential cannot be read. Repair secure storage before signing in.'
      )
    case 'session_expired':
      return translate(
        'auto.components.settings.orcaAccount.sessionExpired',
        'This session has expired. Refresh it or sign in again.'
      )
    case 'network_unavailable':
      return translate(
        'auto.components.settings.orcaAccount.networkUnavailable',
        'HiveCloud is temporarily unreachable. Local work remains available.'
      )
    case 'session_rejected':
      return translate(
        'auto.components.settings.orcaAccount.sessionRejected',
        'HiveCloud rejected this session. Sign in again.'
      )
    case 'authorization_cancelled':
      return translate(
        'auto.components.settings.orcaAccount.authorizationCancelled',
        'Sign-in was cancelled.'
      )
    case 'authorization_timeout':
      return translate(
        'auto.components.settings.orcaAccount.authorizationTimeout',
        'Sign-in timed out before the browser callback completed.'
      )
    case 'server_unavailable':
      return translate(
        'auto.components.settings.orcaAccount.serverUnavailable',
        'HiveCloud is temporarily unavailable. Local work remains available.'
      )
    case 'authorization_failed':
    case undefined:
      return translate(
        'auto.components.settings.orcaAccount.authorizationFailed',
        'HiveCloud sign-in failed. Try again or check the service status.'
      )
  }
}

function statusCopy(state: HiveAccountState | null): string {
  if (!state) {
    return translate(
      'auto.components.settings.orcaAccount.checking',
      'Checking HiveCloud account status…'
    )
  }
  if (state.status === 'unconfigured') {
    return (
      state.setupMessage ??
      translate(
        'auto.components.settings.orcaAccount.unavailable',
        'HiveCloud sign-in is unavailable.'
      )
    )
  }
  if (state.status === 'error') {
    return errorCopy(state.errorCode)
  }
  if (state.status === 'signed-in') {
    return state.errorCode
      ? errorCopy(state.errorCode)
      : translate(
          'auto.components.settings.orcaAccount.connectedDescription',
          'This desktop is securely linked to HiveCloud.'
        )
  }
  return translate(
    'auto.components.settings.orcaAccount.signedOut',
    'Sign in with an existing HiveCloud account. Local projects and provider accounts stay separate.'
  )
}

function expiresCopy(expiresAt: number | undefined): string {
  if (!expiresAt) {
    return translate('auto.components.settings.orcaAccount.unknown', 'Unknown')
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(expiresAt)
  )
}

export function HiveAccountSettingsPane(): React.JSX.Element {
  const [state, setState] = useState<HiveAccountState | null>(null)
  const [busy, setBusy] = useState<'sign-in' | 'refresh' | 'sign-out' | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const connected = state?.status === 'signed-in'
  const secureStorageBlocked =
    state?.errorCode === 'secure_storage_unavailable' ||
    state?.errorCode === 'credential_unreadable'
  const canSignIn = state?.configured === true && !secureStorageBlocked

  useEffect(() => {
    let active = true
    void window.api.hiveAccount
      .getState()
      .then((next) => {
        if (active) {
          setState(next)
        }
      })
      .catch(() => {
        if (active) {
          setState({
            configured: true,
            status: 'error',
            persistence: 'none',
            errorCode: 'authorization_failed'
          })
        }
      })
    const unsubscribeAccountState = window.api.hiveAccount.onStateChanged((next) => {
      if (active) {
        setState(next)
      }
    })
    return () => {
      active = false
      unsubscribeAccountState()
    }
  }, [])

  const signIn = async (sessionProfile: 'TEMPORARY' | 'TRUSTED'): Promise<void> => {
    if (busy) {
      return
    }
    setBusy('sign-in')
    try {
      const result = await window.api.hiveAccount.signIn({ sessionProfile })
      setState(result.state)
      if (result.status === 'signed-in') {
        setSignInOpen(false)
        toast.success(
          translate('auto.components.settings.orcaAccount.signedInToast', 'Signed in to HiveCloud')
        )
      }
      if (result.status === 'failed') {
        toast.error(errorCopy(result.state.errorCode))
      }
    } finally {
      setBusy(null)
    }
  }

  const startSmsSignIn = async (phoneNumber: string, sessionProfile: 'TEMPORARY' | 'TRUSTED') => {
    if (busy) {
      throw new Error('hive_account_sms_sign_in_pending')
    }
    if (!window.api.hiveAccount.startSmsSignIn) {
      throw new Error('sms_sign_in_unavailable')
    }
    setBusy('sign-in')
    try {
      return await window.api.hiveAccount.startSmsSignIn({
        phoneNumber,
        sessionProfile,
        termsAccepted: true
      })
    } finally {
      setBusy(null)
    }
  }

  const cancelSmsSignIn = async (): Promise<void> => {
    await window.api.hiveAccount.cancelSmsSignIn?.()
  }

  const completeSmsSignIn = async (challengeId: string, smsCode: string): Promise<void> => {
    if (busy) {
      return
    }
    setBusy('sign-in')
    try {
      if (!window.api.hiveAccount.completeSmsSignIn) {
        throw new Error('sms_sign_in_unavailable')
      }
      const result = await window.api.hiveAccount.completeSmsSignIn({ challengeId, smsCode })
      setState(result.state)
      if (result.status === 'signed-in') {
        setSignInOpen(false)
        toast.success(
          translate('auto.components.settings.orcaAccount.signedInToast', 'Signed in to HiveCloud')
        )
      } else if (result.status === 'failed') {
        toast.error(errorCopy(result.state.errorCode))
      }
    } finally {
      setBusy(null)
    }
  }

  const refresh = async (): Promise<void> => {
    if (busy) {
      return
    }
    setBusy('refresh')
    try {
      const result = await window.api.hiveAccount.refresh()
      setState(result.state)
      if (result.status === 'refreshed') {
        toast.success(
          translate(
            'auto.components.settings.orcaAccount.refreshedToast',
            'HiveCloud session refreshed'
          )
        )
      }
      if (result.status === 'failed') {
        toast.error(errorCopy(result.state.errorCode))
      }
    } finally {
      setBusy(null)
    }
  }

  const signOut = async (): Promise<void> => {
    if (busy) {
      return
    }
    setBusy('sign-out')
    try {
      const result = await window.api.hiveAccount.signOut()
      setState(result.state)
      setSignOutOpen(false)
      if (result.status === 'local-only') {
        toast.warning(
          translate(
            'auto.components.settings.orcaAccount.localSignOutToast',
            'Signed out locally. Revoke the remote session from HiveCloud Security when online.'
          )
        )
      } else {
        toast.success(
          translate(
            'auto.components.settings.orcaAccount.signedOutToast',
            'Signed out of HiveCloud'
          )
        )
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CircleUserRound className="size-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                {state?.account?.displayName ||
                  translate('auto.components.settings.orcaAccount.account', 'HiveCloud account')}
              </p>
              {connected ? (
                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                  <Check />
                  {translate('auto.components.settings.orcaAccount.connected', 'Connected')}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{statusCopy(state)}</p>
          </div>
          {connected ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void refresh()}
              >
                <RefreshCw className={busy === 'refresh' ? 'animate-spin' : undefined} />
                {translate('auto.components.settings.orcaAccount.refresh', 'Refresh')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => setSignOutOpen(true)}
              >
                {translate('auto.components.settings.orcaAccount.signOut', 'Sign out')}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={!canSignIn || busy !== null}
              onClick={() => setSignInOpen(true)}
            >
              {busy === 'sign-in'
                ? translate('auto.components.settings.orcaAccount.signingIn', 'Signing in…')
                : translate('auto.components.settings.orcaAccount.signIn', 'Sign in to HiveCloud')}
            </Button>
          )}
        </div>

        {connected ? (
          <div className="grid gap-4 border-t border-border/60 pt-5 md:grid-cols-2">
            <div className="flex items-start gap-3">
              <Laptop className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {translate('auto.components.settings.orcaAccount.device', 'Device')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {state.deviceLabel ??
                    translate('auto.components.settings.orcaAccount.defaultDevice', 'Desktop')}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  {translate(
                    'auto.components.settings.orcaAccount.sessionExpires',
                    'Sign-in authorization valid until'
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {expiresCopy(state.sessionExpiresAt)} ·{' '}
                  {state.sessionProfile === 'TRUSTED'
                    ? translate(
                        'auto.components.settings.orcaAccount.trustedSession',
                        'Trusted device'
                      )
                    : translate(
                        'auto.components.settings.orcaAccount.temporarySession',
                        'Temporary device'
                      )}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <HiveAccountSignOutConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        onConfirm={() => void signOut()}
        signingOut={busy === 'sign-out'}
      />
      <HiveAccountSignInConfirmDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        onConfirm={(sessionProfile) => void signIn(sessionProfile)}
        onSmsStart={startSmsSignIn}
        onSmsCancel={cancelSmsSignIn}
        onSmsComplete={completeSmsSignIn}
        signingIn={busy === 'sign-in'}
      />
    </>
  )
}
