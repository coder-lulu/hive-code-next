/* eslint-disable max-lines -- Keeps account state, sign-in methods, and the sidebar action surface synchronized. */

import React from 'react'
import {
  Bell,
  ChevronRight,
  CircleHelp,
  Globe,
  ExternalLink,
  Link2,
  LogIn,
  LogOut,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  RotateCw,
  Settings,
  Sun
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { APP_DISPLAY_NAME, PRODUCT_CONFIG } from '@/product-brand'
import { useAppStore } from '@/store'
import { AccountRuntimeClaimError } from '@/store/slices/account-runtime-cloud'
import type { HiveAccountSignInOptions } from '../../../../shared/hive-account'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { useMountedRef } from '@/hooks/useMountedRef'
import { getUpdateCheckClickOptions, getUpdateCheckHint } from '@/lib/update-check-click-options'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { useMobileSidebarOnboardingBadge } from './mobile-sidebar-onboarding-badge'
import { shouldShowAgentsButton } from './SidebarNav'
import { shouldShowMobileButton, useHiveAccountState } from '@/hooks/use-hive-account-state'
import { useActivityUnreadCount } from '@/components/activity/useActivityUnreadCount'
import { HiveAccountSignInConfirmDialog } from '../settings/HiveAccountSignInConfirmDialog'
import { HiveAccountSignOutConfirmDialog } from '../settings/HiveAccountSignOutConfirmDialog'
import { preloadHiveAccountSettings } from '../settings/settings-page-loader'
import { SidebarFeedbackDialog } from './SidebarFeedbackDialog'
import { SidebarApiQuota } from './SidebarApiQuota'
import accountMascot from '../../../../../resources/desktop-home-mascot.png'

const NO_UPDATE_CHECK_MODIFIERS = {
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false
}
const THEME_OPTIONS = ['system', 'light', 'dark'] as const

const SidebarFooter = React.memo(function SidebarFooter() {
  useTranslation()
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const openActivityPage = useAppStore((state) => state.openActivityPage)
  const openDeviceConnectionsPage = useAppStore((state) => state.openDeviceConnectionsPage)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const settings = useAppStore((state) => state.settings)
  const activeView = useAppStore((state) => state.activeView)
  const updateStatus = useAppStore((state) => state.updateStatus)
  const localRuntimeOwnership = useAppStore((state) => state.localRuntimeOwnership)
  const refreshLocalRuntimeOwnership = useAppStore((state) => state.refreshLocalRuntimeOwnership)
  const claimLocalRuntimeForAccount = useAppStore((state) => state.claimLocalRuntimeForAccount)
  const {
    state: accountState,
    commitState: commitAccountState,
    refreshState: refreshAccountState
  } = useHiveAccountState()
  const [signInOpen, setSignInOpen] = React.useState(false)
  const [signOutOpen, setSignOutOpen] = React.useState(false)
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [signingIn, setSigningIn] = React.useState(false)
  const [signingOut, setSigningOut] = React.useState(false)
  const [isRestarting, setIsRestarting] = React.useState(false)
  const [claimingLocalRuntime, setClaimingLocalRuntime] = React.useState(false)
  const [claimSucceeded, setClaimSucceeded] = React.useState(false)
  const [claimErrorMessage, setClaimErrorMessage] = React.useState<string | null>(null)
  const [appVersion, setAppVersion] = React.useState<string | null>(null)
  const claimingLocalRuntimeRef = React.useRef(false)
  const mountedRef = useMountedRef()
  const confirmAction = useConfirmationDialog()
  const updateCheckModifiersRef = React.useRef(NO_UPDATE_CHECK_MODIFIERS)
  const showActivity = shouldShowAgentsButton(settings)
  const showMobile = shouldShowMobileButton(accountState)
  const notificationUnreadCount = useActivityUnreadCount(showActivity, 'sidebar-badge')
  const mobileOnboardingBadge = useMobileSidebarOnboardingBadge(showMobile)
  const connected = accountState?.status === 'signed-in'
  React.useEffect(() => {
    let cancelled = false
    void Promise.resolve(window.api?.updater?.getVersion?.())
      .then((version) => {
        if (!cancelled && typeof version === 'string' && version.trim()) {
          setAppVersion(version.trim())
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  const secureStorageBlocked =
    accountState?.errorCode === 'secure_storage_unavailable' ||
    accountState?.errorCode === 'credential_unreadable'
  const canSignIn = accountState?.configured === true && !secureStorageBlocked

  React.useEffect(() => {
    if (!claimSucceeded) {
      return
    }
    const timeout = window.setTimeout(() => setClaimSucceeded(false), 1_200)
    return () => window.clearTimeout(timeout)
  }, [claimSucceeded])

  const openSettingsPane = (
    pane: 'general' | 'appearance' | 'notifications' | 'orca-account'
  ): void => {
    if (pane === 'orca-account') {
      preloadHiveAccountSettings()
    }
    openSettingsTarget({ pane, repoId: null })
    openSettingsPage()
  }

  const openNotifications = (): void => {
    if (showActivity) {
      openActivityPage()
      return
    }
    openSettingsPane('notifications')
  }

  const requestSignIn = (): void => {
    if (canSignIn) {
      setSignInOpen(true)
      return
    }
    openSettingsPane('orca-account')
  }

  const signIn = async (
    sessionProfile: HiveAccountSignInOptions['sessionProfile']
  ): Promise<void> => {
    if (signingIn) {
      return
    }
    setSigningIn(true)
    try {
      const result = await window.api.hiveAccount.signIn({ sessionProfile })
      commitAccountState(result.state)
      if (result.status === 'signed-in') {
        setSignInOpen(false)
        toast.success(
          translate('components.sidebarAccount.signInSuccess', 'Signed in to HiveCloud')
        )
      } else if (result.status === 'failed') {
        toast.error(
          translate(
            'components.sidebarAccount.signInFailed',
            'HiveCloud sign-in failed. Try again or check the service status.'
          )
        )
      }
    } catch {
      toast.error(
        translate(
          'components.sidebarAccount.signInFailed',
          'HiveCloud sign-in failed. Try again or check the service status.'
        )
      )
    } finally {
      setSigningIn(false)
    }
  }

  const startSmsSignIn = async (
    phoneNumber: string,
    sessionProfile: HiveAccountSignInOptions['sessionProfile']
  ) => {
    if (signingIn) {
      throw new Error('hive_account_sms_sign_in_pending')
    }
    if (!window.api.hiveAccount.startSmsSignIn) {
      throw new Error('sms_sign_in_unavailable')
    }
    setSigningIn(true)
    try {
      return await window.api.hiveAccount.startSmsSignIn({
        phoneNumber,
        sessionProfile,
        termsAccepted: true
      })
    } finally {
      setSigningIn(false)
    }
  }

  const cancelSmsSignIn = async (): Promise<void> => {
    await window.api.hiveAccount.cancelSmsSignIn?.()
  }

  const completeSmsSignIn = async (challengeId: string, smsCode: string): Promise<void> => {
    if (signingIn) {
      return
    }
    setSigningIn(true)
    try {
      if (!window.api.hiveAccount.completeSmsSignIn) {
        throw new Error('sms_sign_in_unavailable')
      }
      const result = await window.api.hiveAccount.completeSmsSignIn({ challengeId, smsCode })
      commitAccountState(result.state)
      if (result.status === 'signed-in') {
        setSignInOpen(false)
        toast.success(
          translate('components.sidebarAccount.signInSuccess', 'Signed in to HiveCloud')
        )
      } else if (result.status === 'failed') {
        toast.error(
          translate(
            'components.sidebarAccount.signInFailed',
            'HiveCloud sign-in failed. Try again or check the service status.'
          )
        )
      }
    } catch {
      toast.error(
        translate(
          'components.sidebarAccount.signInFailed',
          'HiveCloud sign-in failed. Try again or check the service status.'
        )
      )
    } finally {
      setSigningIn(false)
    }
  }

  const signOut = async (): Promise<void> => {
    if (signingOut) {
      return
    }
    setSigningOut(true)
    try {
      const result = await window.api.hiveAccount.signOut()
      commitAccountState(result.state)
      setSignOutOpen(false)
      if (result.status === 'local-only') {
        toast.warning(
          translate(
            'components.sidebarAccount.localSignOut',
            'Signed out locally. Revoke the remote session from HiveCloud Security when online.'
          )
        )
      } else {
        toast.success(
          translate('components.sidebarAccount.signOutSuccess', 'Signed out of HiveCloud')
        )
      }
    } catch {
      toast.error(
        translate(
          'components.sidebarAccount.signOutFailed',
          "Couldn't sign out of HiveCloud. Check file permissions and try again."
        )
      )
      await refreshAccountState(false)
    } finally {
      setSigningOut(false)
    }
  }

  const accountDisplayName = accountState?.account?.displayName || APP_DISPLAY_NAME
  const accountStatusLabel = connected
    ? translate('components.sidebarAccount.connected', 'HiveCloud connected')
    : accountState?.status === 'error'
      ? translate('components.sidebarAccount.statusUnknown', 'Connection status pending')
      : translate('components.sidebarAccount.localMode', 'Local mode')
  const accountStatusTone = connected
    ? 'is-connected'
    : accountState?.status === 'error'
      ? 'is-warning'
      : 'is-local'
  const activeTheme = settings?.theme ?? 'system'
  const openAccountCenter = (): void => openSettingsPane('orca-account')

  const handleCheckForUpdates = (): void => {
    const modifiers = updateCheckModifiersRef.current
    updateCheckModifiersRef.current = NO_UPDATE_CHECK_MODIFIERS
    if (updateStatus.state === 'checking' || updateStatus.state === 'downloading') {
      return
    }
    void window.api.updater.check(getUpdateCheckClickOptions(modifiers))
  }

  const handleCheckForUpdatesPointerDown = (event: React.PointerEvent): void => {
    updateCheckModifiersRef.current = {
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    }
  }

  const handleRestart = (): void => {
    if (isRestarting) {
      return
    }
    setIsRestarting(true)
    toast.info(
      translate('components.sidebarAccount.restarting', 'Restarting {{value0}}…', {
        value0: APP_DISPLAY_NAME
      })
    )
    void window.api.app.restart().catch((error) => {
      if (mountedRef.current) {
        setIsRestarting(false)
        toast.error(
          translate('components.sidebarAccount.restartFailed', "Couldn't restart {{value0}}.", {
            value0: APP_DISPLAY_NAME
          }),
          { description: error instanceof Error ? error.message : undefined }
        )
      }
    })
  }

  const requestRestart = async (): Promise<void> => {
    const confirmed = await confirmAction({
      title: translate('components.sidebarAccount.restartConfirmTitle', 'Restart {{value0}}?', {
        value0: APP_DISPLAY_NAME
      }),
      description: translate(
        'components.sidebarAccount.restartConfirmDescription',
        'Unsaved work may be lost.'
      ),
      confirmLabel: translate('components.sidebarAccount.restartConfirmAction', 'Restart'),
      cancelLabel: translate('components.sidebarAccount.cancel', 'Cancel')
    })
    if (confirmed) {
      handleRestart()
    }
  }

  const handleThemeKeyboardSelection = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const currentIndex = THEME_OPTIONS.indexOf(activeTheme)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % THEME_OPTIONS.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = THEME_OPTIONS.length - 1
    }
    if (nextIndex === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const nextTheme = THEME_OPTIONS[nextIndex]
    const themeGroup = event.currentTarget
    void updateSettings({ theme: nextTheme })
    window.requestAnimationFrame(() => {
      themeGroup.querySelector<HTMLButtonElement>(`[data-theme-option="${nextTheme}"]`)?.focus()
    })
  }

  const handleLocalRuntimeOwnership = async (): Promise<void> => {
    if (claimingLocalRuntimeRef.current || signingIn) {
      return
    }
    const expectedAccountId = accountState?.account?.accountId
    if (!expectedAccountId) {
      return
    }
    claimingLocalRuntimeRef.current = true
    setClaimErrorMessage(null)
    setClaimSucceeded(false)
    setClaimingLocalRuntime(true)
    try {
      let ownership = localRuntimeOwnership
      if (
        !ownership ||
        ownership.relation === 'UNVERIFIABLE' ||
        ownership.accountId !== expectedAccountId
      ) {
        ownership = await refreshLocalRuntimeOwnership()
      }
      if (!mountedRef.current) {
        return
      }
      if (ownership.accountId && ownership.accountId !== expectedAccountId) {
        throw new AccountRuntimeClaimError('ACCOUNT_CHANGED')
      }
      const relation = ownership.relation
      if (relation === 'CLAIMED_BY_CURRENT') {
        return
      }
      if (relation !== 'UNREGISTERED' && relation !== 'PENDING_CLAIM') {
        if (relation === 'UNVERIFIABLE') {
          throw new AccountRuntimeClaimError('OWNERSHIP_UNAVAILABLE')
        }
        return
      }

      const state = await claimLocalRuntimeForAccount(expectedAccountId)
      if (state.accountId !== expectedAccountId) {
        throw new AccountRuntimeClaimError('ACCOUNT_CHANGED')
      }
      if (state.relation === 'CLAIMED_BY_CURRENT' && mountedRef.current) {
        setClaimSucceeded(true)
        toast.success(
          translate(
            'components.sidebarAccount.runtimeClaimed',
            'This computer is now available through your HiveCloud account.'
          )
        )
      }
    } catch (error) {
      if (!mountedRef.current) {
        return
      }
      const message =
        error instanceof AccountRuntimeClaimError
          ? error.code === 'STEP_UP_REQUIRED'
            ? translate(
                'components.sidebarAccount.runtimeClaimStepUp',
                'Verify your account again before claiming this computer.'
              )
            : error.code === 'ACCOUNT_CHANGED'
              ? translate(
                  'components.sidebarAccount.runtimeClaimAccountChanged',
                  'The account changed during verification. Sign in with the original account and try again.'
                )
              : translate(
                  'components.sidebarAccount.runtimeClaimFailed',
                  "Couldn't claim this computer. Try again from this device."
                )
          : translate(
              'components.sidebarAccount.runtimeClaimFailed',
              "Couldn't claim this computer. Try again from this device."
            )
      setClaimErrorMessage(message)
      toast.error(message)
    } finally {
      claimingLocalRuntimeRef.current = false
      if (mountedRef.current) {
        setClaimingLocalRuntime(false)
      }
    }
  }

  const localRuntimeOwnershipPresentation = (() => {
    if (claimingLocalRuntime || localRuntimeOwnership?.claimUserCode) {
      return {
        label:
          localRuntimeOwnership?.claimUserCode ??
          translate('components.sidebarAccount.claimingComputer', 'Claiming…'),
        description: translate(
          'components.sidebarAccount.claimingComputerDescription',
          'Claiming this device for {{value0}}.',
          { value0: accountDisplayName }
        ),
        tone: 'is-loading',
        actionable: false,
        loading: true
      }
    }
    if (claimSucceeded) {
      return {
        label: translate('components.sidebarAccount.claimSucceeded', 'Claim successful'),
        description: translate(
          'components.sidebarAccount.computerClaimedDescription',
          'This device is claimed by your HiveCloud account.'
        ),
        tone: 'is-success',
        actionable: false,
        loading: false
      }
    }
    if (claimErrorMessage) {
      return {
        label: translate('components.sidebarAccount.claimFailedRetry', 'Claim failed · Retry'),
        description: claimErrorMessage,
        tone: 'is-error',
        actionable: true,
        loading: false
      }
    }
    switch (localRuntimeOwnership?.relation ?? 'ANALYZING') {
      case 'ANALYZING':
        return {
          label: translate('components.sidebarAccount.analyzingComputer', 'Checking…'),
          description: translate(
            'components.sidebarAccount.analyzingComputerDescription',
            'Checking whether this device is claimed.'
          ),
          tone: 'is-loading',
          actionable: false,
          loading: true
        }
      case 'UNREGISTERED':
        return {
          label: translate('components.sidebarAccount.claimComputer', 'Not claimed · Claim device'),
          description: translate(
            'components.sidebarAccount.claimComputerDescription',
            "Claim this device for {{value0}}'s HiveCloud account.",
            { value0: accountDisplayName }
          ),
          tone: 'is-claimable',
          actionable: true,
          loading: false
        }
      case 'PENDING_CLAIM':
        return {
          label: translate('components.sidebarAccount.continueComputerClaim', 'Pending · Continue'),
          description: translate(
            'components.sidebarAccount.continueComputerClaimDescription',
            'Continue claiming this device for {{value0}}.',
            { value0: accountDisplayName }
          ),
          tone: 'is-claimable',
          actionable: true,
          loading: false
        }
      case 'CLAIMED_BY_CURRENT':
        return {
          label: translate('components.sidebarAccount.claimed', 'Claimed'),
          description: translate(
            'components.sidebarAccount.computerClaimedDescription',
            'This device is claimed by your HiveCloud account.'
          ),
          tone: 'is-claimed',
          actionable: false,
          loading: false
        }
      case 'CLAIMED_BY_OTHER':
        return {
          label: translate(
            'components.sidebarAccount.computerClaimedElsewhere',
            'Claimed elsewhere'
          ),
          description: translate(
            'components.sidebarAccount.computerClaimedElsewhereDescription',
            'This device is claimed by another HiveCloud account.'
          ),
          tone: 'is-unavailable',
          actionable: false,
          loading: false
        }
      case 'TRANSFER_PENDING':
        return {
          label: translate('components.sidebarAccount.computerTransferPending', 'Transfer pending'),
          description: translate(
            'components.sidebarAccount.computerTransferPendingDescription',
            'A device ownership transfer is in progress.'
          ),
          tone: 'is-loading',
          actionable: false,
          loading: false
        }
      case 'UNVERIFIABLE':
        return {
          label: translate(
            'components.sidebarAccount.retryComputerAnalysis',
            'Status unknown · Retry'
          ),
          description: translate(
            'components.sidebarAccount.retryComputerAnalysisDescription',
            'Device ownership could not be verified. Try again.'
          ),
          tone: 'is-error',
          actionable: true,
          loading: false
        }
    }
  })()

  const updateStatusLabel = (() => {
    switch (updateStatus.state) {
      case 'checking':
        return translate('components.sidebarAccount.checkingUpdates', 'Checking…')
      case 'downloading':
        return translate('components.sidebarAccount.downloadingUpdate', 'Downloading…')
      case 'downloaded':
        return translate('components.sidebarAccount.updateReady', 'Ready to restart')
      case 'available':
        return translate('components.sidebarAccount.updateAvailable', 'Update available')
      case 'error':
        return translate('components.sidebarAccount.updateCheckFailed', 'Check failed')
      case 'disabled':
        return translate('components.sidebarAccount.updatesUnavailable', 'Unavailable')
      case 'not-available':
        return translate('components.sidebarAccount.upToDate', 'Up to date')
      case 'idle':
        return translate('components.sidebarAccount.checkNow', 'Check now')
    }
  })()
  const updateAvailable =
    updateStatus.state === 'available' ||
    updateStatus.state === 'downloading' ||
    updateStatus.state === 'downloaded' ||
    (updateStatus.state === 'error' && Boolean(updateStatus.version))
  const notificationStatusLabel =
    notificationUnreadCount > 0
      ? translate('components.sidebarAccount.unreadCount', '{{count}} unread', {
          count: notificationUnreadCount
        })
      : translate('components.sidebarAccount.noUnread', 'No unread')
  const notificationMenuLabel = showActivity
    ? translate('components.sidebarAccount.notifications', 'Notifications')
    : translate('components.sidebarAccount.notificationSettings', 'Notification settings')

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-t border-worktree-sidebar-border px-2 py-1.5">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`hive-account-trigger flex h-14 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-worktree-sidebar-foreground transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-worktree-sidebar-ring/50${accountState === null ? ' cursor-wait opacity-70' : ''}`}
              aria-label={translate(
                'components.sidebarAccount.menuLabel',
                'Account menu: {{name}}',
                {
                  name: accountDisplayName
                }
              )}
              data-account-status={connected ? 'signed-in' : 'signed-out'}
              data-sidebar-account-trigger=""
              disabled={accountState === null}
              onPointerEnter={preloadHiveAccountSettings}
              onFocus={preloadHiveAccountSettings}
            >
              <span className="hive-account-trigger-avatar" data-account-avatar="">
                <img src={accountMascot} alt="" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col justify-center leading-none">
                <span className="truncate text-[13px] font-semibold">
                  {connected
                    ? accountDisplayName
                    : translate('components.sidebarAccount.localMode', 'Local mode')}
                </span>
                <span className={`hive-account-trigger-status ${accountStatusTone}`}>
                  <span className="hive-account-status-dot" aria-hidden="true" />
                  {connected
                    ? accountStatusLabel
                    : translate('components.sidebarAccount.signIn', 'Sign in to HiveCloud')}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={10}
            className="hive-account-popover"
            data-account-popover=""
          >
            <div className="hive-account-popover-header" data-account-identity="">
              <button
                type="button"
                className="hive-account-popover-identity-hit-target"
                onClick={openAccountCenter}
                aria-label={translate(
                  'components.sidebarAccount.openCenter',
                  'Open account center'
                )}
                data-account-center-entry=""
              />
              <span className="hive-account-popover-avatar">
                <img src={accountMascot} alt="" aria-hidden="true" />
              </span>
              <span className="hive-account-popover-identity-copy">
                <span className="hive-account-popover-name-row">
                  <strong title={accountDisplayName}>
                    {connected
                      ? accountDisplayName
                      : translate('components.sidebarAccount.localMode', 'Local mode')}
                  </strong>
                  {connected ? (
                    localRuntimeOwnershipPresentation.actionable ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={`hive-account-ownership-control ${localRuntimeOwnershipPresentation.tone}`}
                            aria-label={localRuntimeOwnershipPresentation.description}
                            data-local-runtime-ownership={
                              localRuntimeOwnership?.relation ?? 'ANALYZING'
                            }
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleLocalRuntimeOwnership()
                            }}
                          >
                            <Link2 aria-hidden="true" />
                            <span
                              key={localRuntimeOwnershipPresentation.label}
                              className="hive-account-ownership-label"
                            >
                              {localRuntimeOwnershipPresentation.label}
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6}>
                          {localRuntimeOwnershipPresentation.description}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span
                        className={`hive-account-ownership-control ${localRuntimeOwnershipPresentation.tone}`}
                        role="status"
                        aria-label={localRuntimeOwnershipPresentation.description}
                        data-local-runtime-ownership={
                          localRuntimeOwnership?.relation ?? 'ANALYZING'
                        }
                      >
                        {localRuntimeOwnershipPresentation.loading ? (
                          <Loader2 className="animate-spin" aria-hidden="true" />
                        ) : (
                          <span className="hive-account-ownership-dot" aria-hidden="true" />
                        )}
                        <span
                          key={localRuntimeOwnershipPresentation.label}
                          className="hive-account-ownership-label"
                        >
                          {localRuntimeOwnershipPresentation.label}
                        </span>
                      </span>
                    )
                  ) : null}
                </span>
                <span>
                  {connected
                    ? translate('components.sidebarAccount.cloudAccount', 'HiveCloud account')
                    : translate(
                        'components.sidebarAccount.localWorkspace',
                        'HiveCode local workspace'
                      )}
                </span>
                <em title={translate('components.sidebarAccount.workAccount', 'Work account')}>
                  {connected
                    ? translate('components.sidebarAccount.workAccount', 'Work account')
                    : translate(
                        'components.sidebarAccount.notConnected',
                        'Cloud account not connected'
                      )}
                </em>
              </span>
              <ChevronRight className="hive-account-popover-identity-chevron" aria-hidden="true" />
            </div>

            <div className="hive-account-menu-scroll scrollbar-sleek">
              {!connected ? (
                <div className="hive-account-local-cta">
                  <p>
                    {translate(
                      'components.sidebarAccount.localFeatures',
                      'HiveCode local projects, terminals, and agent features remain available.'
                    )}
                  </p>
                  <button type="button" className="hive-account-primary" onClick={requestSignIn}>
                    <LogIn className="size-4" />
                    {translate('components.sidebarAccount.signIn', 'Sign in to HiveCloud')}
                  </button>
                  <span>
                    {translate(
                      'components.sidebarAccount.cloudBenefits',
                      'Sign in to manage cross-device Runtimes, sessions, and organization resources.'
                    )}
                  </span>
                </div>
              ) : null}

              <div className="hive-account-menu-group">
                <SidebarApiQuota
                  accountId={connected ? (accountState?.account?.accountId ?? null) : null}
                  onOpenDetails={openAccountCenter}
                  onSignIn={requestSignIn}
                />
                <DropdownMenuItem
                  className="hive-account-menu-item"
                  onSelect={() => {
                    void window.api.shell
                      .openUrl(new URL('/', PRODUCT_CONFIG.services.identity.userLoginUrl).href)
                      .catch(() => {
                        toast.error(
                          translate(
                            'components.sidebarAccount.openWebFailed',
                            'Could not open the Web app. Please try again.'
                          )
                        )
                      })
                  }}
                >
                  <Globe className="hive-account-menu-icon" />
                  <span>{translate('components.sidebarAccount.openWeb', 'Open Web app')}</span>
                  <ExternalLink className="hive-account-menu-chevron" />
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="hive-account-menu-item"
                  onSelect={() => openSettingsPane('general')}
                >
                  <Settings className="hive-account-menu-icon" />
                  <span>{translate('components.sidebarAccount.settings', 'Settings')}</span>
                  <ChevronRight className="hive-account-menu-chevron" />
                </DropdownMenuItem>
                <div className="hive-account-menu-item hive-account-theme-row">
                  <Sun className="hive-account-menu-icon" />
                  <span>{translate('components.sidebarAccount.appearance', 'Appearance')}</span>
                  <ToggleGroup
                    type="single"
                    value={activeTheme}
                    className="hive-account-theme-switch"
                    data-theme={activeTheme}
                    aria-label={translate('components.sidebarAccount.theme', 'Theme')}
                    onKeyDown={handleThemeKeyboardSelection}
                    onValueChange={(theme) => {
                      if (theme === 'system' || theme === 'light' || theme === 'dark') {
                        void updateSettings({ theme })
                      }
                    }}
                  >
                    {THEME_OPTIONS.map((theme) => (
                      <ToggleGroupItem
                        key={theme}
                        value={theme}
                        data-theme-option={theme}
                        className={activeTheme === theme ? 'is-active' : ''}
                      >
                        {translate(
                          `components.sidebarAccount.theme${theme[0].toUpperCase()}${theme.slice(1)}`,
                          theme
                        )}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <DropdownMenuItem className="hive-account-menu-item" onSelect={openNotifications}>
                  <Bell className="hive-account-menu-icon" />
                  <span>{notificationMenuLabel}</span>
                  {showActivity ? (
                    <span
                      className="hive-account-menu-value"
                      data-notification-unread={notificationUnreadCount > 0 ? 'true' : 'false'}
                    >
                      {notificationStatusLabel}
                    </span>
                  ) : null}
                  <ChevronRight className="hive-account-menu-chevron" />
                </DropdownMenuItem>
              </div>

              <div className="hive-account-menu-group">
                <DropdownMenuItem
                  className="hive-account-menu-item"
                  onSelect={() => setFeedbackOpen(true)}
                >
                  <CircleHelp className="hive-account-menu-icon" />
                  <span>
                    {translate('components.sidebarAccount.helpFeedback', 'Help and feedback')}
                  </span>
                  <ChevronRight className="hive-account-menu-chevron" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hive-account-menu-item"
                  disabled={
                    updateStatus.state === 'checking' || updateStatus.state === 'downloading'
                  }
                  onPointerDown={handleCheckForUpdatesPointerDown}
                  onSelect={handleCheckForUpdates}
                  title={getUpdateCheckHint()}
                >
                  <RefreshCw className="hive-account-menu-icon" />
                  <span>
                    {translate('components.sidebarAccount.checkUpdates', 'Check for updates')}
                  </span>
                  <span className="hive-account-menu-value hive-account-update-status">
                    {updateStatus.state === 'checking' || updateStatus.state === 'downloading' ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                    ) : null}
                    <span>{appVersion ?? updateStatusLabel}</span>
                  </span>
                  {updateAvailable ? (
                    <span
                      className="hive-account-update-dot"
                      title={translate(
                        'components.sidebarAccount.updateAvailable',
                        'Update available'
                      )}
                      aria-label={translate(
                        'components.sidebarAccount.updateAvailable',
                        'Update available'
                      )}
                    />
                  ) : null}
                  <ChevronRight className="hive-account-menu-chevron" />
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hive-account-menu-item"
                  disabled={isRestarting}
                  onSelect={() => void requestRestart()}
                >
                  <RotateCw className="hive-account-menu-icon" />
                  <span>
                    {translate('components.sidebarAccount.restart', 'Restart {{value0}}', {
                      value0: APP_DISPLAY_NAME
                    })}
                  </span>
                  <ChevronRight className="hive-account-menu-chevron" />
                </DropdownMenuItem>
              </div>
            </div>

            {connected ? (
              <div className="hive-account-danger-group">
                <DropdownMenuItem
                  className="hive-account-menu-item hive-account-sign-out"
                  onSelect={() => setSignOutOpen(true)}
                >
                  <LogOut className="hive-account-menu-icon" />
                  <span>{translate('components.sidebarAccount.signOut', 'Sign out')}</span>
                </DropdownMenuItem>
              </div>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={activeView === 'activity' ? 'secondary' : 'ghost'}
              size="icon-sm"
              className="relative shrink-0 text-muted-foreground"
              aria-label={
                showActivity
                  ? translate('components.sidebarAccount.activity', 'Activity')
                  : translate('components.sidebarAccount.notifications', 'Notifications')
              }
              onClick={openNotifications}
            >
              <Bell className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {showActivity
              ? translate('components.sidebarAccount.activity', 'Activity')
              : translate('components.sidebarAccount.notifications', 'Notifications')}
          </TooltipContent>
        </Tooltip>

        {showMobile ? (
          <div className="relative shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={activeView === 'device-connections' ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={translate('phoneConnection.title', 'Phone connection')}
                  aria-current={activeView === 'device-connections' ? 'page' : undefined}
                  onClick={() => {
                    mobileOnboardingBadge.dismiss()
                    openDeviceConnectionsPage()
                  }}
                >
                  <MonitorSmartphone className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {translate('phoneConnection.title', 'Phone connection')}
              </TooltipContent>
            </Tooltip>
            {mobileOnboardingBadge.visible ? (
              <span
                className={cn(
                  'pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary',
                  activeView === 'device-connections' && 'bg-primary-foreground'
                )}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <HiveAccountSignInConfirmDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        onConfirm={(sessionProfile) => void signIn(sessionProfile)}
        onSmsStart={startSmsSignIn}
        onSmsCancel={cancelSmsSignIn}
        onSmsComplete={completeSmsSignIn}
        signingIn={signingIn}
      />
      <HiveAccountSignOutConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        onConfirm={() => void signOut()}
        signingOut={signingOut}
      />
      <SidebarFeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  )
})

export default SidebarFooter
