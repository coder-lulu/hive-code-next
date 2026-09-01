import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  HiveAccountErrorCode,
  HiveAccountLoginProviderId,
  HiveAccountState
} from '../../../../shared/hive-account'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  HiveAccountSettingsContent,
  type HiveAccountPlatformInfo
} from './HiveAccountSettingsContent'
import { HiveAccountSignInConfirmDialog } from './HiveAccountSignInConfirmDialog'
import { HiveAccountSignOutConfirmDialog } from './HiveAccountSignOutConfirmDialog'
import { useHiveAccountLoginProviders } from './use-hive-account-login-providers'

const NOOP = (): void => undefined

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
        'This session has expired. Sign in again.'
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

export function HiveAccountSettingsPane({
  onOpenRuntimeDetails = NOOP
}: {
  onOpenRuntimeDetails?: () => void
}): React.JSX.Element {
  const [state, setState] = useState<HiveAccountState | null>(null)
  const [busy, setBusy] = useState<'sign-in' | 'refresh' | 'sign-out' | 'claim' | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [platformInfo] = useState<HiveAccountPlatformInfo | null>(() => {
    try {
      const info = window.api.platform?.get()
      return info ? { platform: info.platform, osRelease: info.osRelease, arch: info.arch } : null
    } catch {
      return null
    }
  })
  const { providers: loginProviders, clearProviders } = useHiveAccountLoginProviders(signInOpen)
  const directory = useAppStore((store) => store.accountRuntimeDirectory)
  const ownership = useAppStore((store) => store.localRuntimeOwnership)
  const refreshAccountRuntimeCloud = useAppStore((store) => store.refreshAccountRuntimeCloud)
  const claimLocalRuntimeForAccount = useAppStore((store) => store.claimLocalRuntimeForAccount)
  const secureStorageBlocked =
    state?.errorCode === 'secure_storage_unavailable' ||
    state?.errorCode === 'credential_unreadable'
  const canSignIn = state?.configured === true && !secureStorageBlocked

  useEffect(() => {
    let active = true
    let receivedLiveState = false
    const unsubscribeAccountState = window.api.hiveAccount.onStateChanged((next) => {
      if (active) {
        receivedLiveState = true
        setState(next)
      }
    })
    void window.api.hiveAccount
      .getState()
      .then((next) => {
        if (active && !receivedLiveState) {
          setState(next)
        }
      })
      .catch(() => {
        if (active && !receivedLiveState) {
          setState({
            configured: true,
            status: 'error',
            persistence: 'none',
            errorCode: 'authorization_failed'
          })
        }
      })
    return () => {
      active = false
      unsubscribeAccountState()
    }
  }, [])

  const openSignIn = (): void => {
    clearProviders()
    setSignInOpen(true)
  }

  const signIn = async (
    sessionProfile: 'TEMPORARY' | 'TRUSTED',
    providerId?: HiveAccountLoginProviderId
  ): Promise<void> => {
    if (busy) {
      return
    }
    setBusy('sign-in')
    try {
      const result = await window.api.hiveAccount.signIn(
        providerId ? { sessionProfile, providerId } : { sessionProfile }
      )
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
      const [accountResult, runtimeResult] = await Promise.allSettled([
        window.api.hiveAccount.refresh(),
        refreshAccountRuntimeCloud()
      ])
      if (accountResult.status === 'fulfilled') {
        setState(accountResult.value.state)
        if (accountResult.value.status === 'failed') {
          toast.error(errorCopy(accountResult.value.state.errorCode))
        }
      }
      if (accountResult.status === 'rejected' || runtimeResult.status === 'rejected') {
        toast.error(
          translate(
            'auto.components.settings.orcaAccount.connectionCheckFailed',
            'Connection status could not be fully updated.'
          )
        )
      }
    } finally {
      setBusy(null)
    }
  }

  const claimRuntime = async (): Promise<void> => {
    const expectedAccountId = state?.account?.accountId
    if (busy || !expectedAccountId) {
      return
    }
    setBusy('claim')
    try {
      const result = await claimLocalRuntimeForAccount(expectedAccountId)
      if (result.accountId !== expectedAccountId) {
        throw new Error('hive_runtime_cloud_account_changed')
      }
      if (result.relation === 'CLAIMED_BY_CURRENT') {
        toast.success(
          translate(
            'auto.components.settings.orcaAccount.runtimeClaimedToast',
            'Runtime linked to this HiveCloud account'
          )
        )
      }
    } catch {
      toast.error(
        translate(
          'auto.components.settings.orcaAccount.runtimeClaimFailed',
          'This Runtime could not be linked. Check the connection and try again.'
        )
      )
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
            'Signed out on this device, but cloud session revocation is not yet confirmed. You can finish it later in HiveCloud Security.'
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
      <HiveAccountSettingsContent
        state={state}
        directory={directory}
        ownership={ownership}
        platformInfo={platformInfo}
        busy={busy}
        canSignIn={canSignIn}
        onSignIn={openSignIn}
        onRefresh={() => void refresh()}
        onClaimRuntime={() => void claimRuntime()}
        onOpenRuntimeDetails={onOpenRuntimeDetails}
        onSignOut={() => setSignOutOpen(true)}
      />
      <HiveAccountSignOutConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        onConfirm={() => void signOut()}
        signingOut={busy === 'sign-out'}
      />
      <HiveAccountSignInConfirmDialog
        open={signInOpen}
        onOpenChange={(open) => {
          setSignInOpen(open)
          if (!open) {
            clearProviders()
          }
        }}
        onConfirm={(sessionProfile, providerId) => void signIn(sessionProfile, providerId)}
        onSmsStart={startSmsSignIn}
        onSmsCancel={cancelSmsSignIn}
        onSmsComplete={completeSmsSignIn}
        providers={loginProviders}
        signingIn={busy === 'sign-in'}
      />
    </>
  )
}
