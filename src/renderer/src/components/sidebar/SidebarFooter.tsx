/* eslint-disable max-lines -- Keeps account state, sign-in methods, and the sidebar action surface synchronized. */

import React from 'react'
import {
  Bell,
  ChevronRight,
  CircleHelp,
  Cloud,
  Copy,
  Database,
  LogIn,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Settings,
  Sun,
  UserRound
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { useAppStore } from '@/store'
import type { HiveAccountSignInOptions, HiveAccountState } from '../../../../shared/hive-account'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { HideSidebarMenu } from './sidebar-nav-controls'
import { useMobileSidebarOnboardingBadge } from './mobile-sidebar-onboarding-badge'
import { shouldShowAgentsButton, shouldShowMobileButton } from './SidebarNav'
import { HiveAccountSignInConfirmDialog } from '../settings/HiveAccountSignInConfirmDialog'
import { HiveAccountSignOutConfirmDialog } from '../settings/HiveAccountSignOutConfirmDialog'
import accountMascot from '../../../../../resources/desktop-home-mascot.png'

const SidebarFooter = React.memo(function SidebarFooter() {
  useTranslation()
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const openActivityPage = useAppStore((state) => state.openActivityPage)
  const openMobilePage = useAppStore((state) => state.openMobilePage)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const settings = useAppStore((state) => state.settings)
  const activeView = useAppStore((state) => state.activeView)
  const [accountState, setAccountState] = React.useState<HiveAccountState | null>(null)
  const [signInOpen, setSignInOpen] = React.useState(false)
  const [signOutOpen, setSignOutOpen] = React.useState(false)
  const [signingIn, setSigningIn] = React.useState(false)
  const [signingOut, setSigningOut] = React.useState(false)
  const showActivity = shouldShowAgentsButton(settings)
  const showMobile = shouldShowMobileButton(settings)
  const mobileOnboardingBadge = useMobileSidebarOnboardingBadge(showMobile)
  const connected = accountState?.status === 'signed-in'
  const secureStorageBlocked =
    accountState?.errorCode === 'secure_storage_unavailable' ||
    accountState?.errorCode === 'credential_unreadable'
  const canSignIn = accountState?.configured === true && !secureStorageBlocked

  React.useEffect(() => {
    let disposed = false
    const loadAccountState = (): void => {
      void window.api.hiveAccount
        .getState()
        .then((nextState) => {
          if (!disposed) {
            setAccountState(nextState)
          }
        })
        .catch(() => {
          if (!disposed) {
            setAccountState({
              configured: true,
              status: 'error',
              persistence: 'none',
              errorCode: 'authorization_failed'
            })
          }
        })
    }

    loadAccountState()
    const unsubscribeAccountState = window.api.hiveAccount.onStateChanged((nextState) => {
      if (!disposed) {
        setAccountState(nextState)
      }
    })
    window.addEventListener('focus', loadAccountState)
    return () => {
      disposed = true
      unsubscribeAccountState()
      window.removeEventListener('focus', loadAccountState)
    }
  }, [])

  const openSettingsPane = (pane: 'appearance' | 'notifications' | 'orca-account'): void => {
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

  const hideMobileButton = (): void => {
    void updateSettings({ showMobileButton: false })
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
      setAccountState(result.state)
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
      setAccountState(result.state)
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
      setAccountState(result.state)
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
      try {
        setAccountState(await window.api.hiveAccount.getState())
      } catch {
        // Keep the last known state when the authoritative state cannot be read either.
      }
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
  const copyAccountName = (): void => {
    void navigator.clipboard?.writeText(accountDisplayName)
    toast.success(
      translate('components.sidebarAccount.accountCopied', 'Account information copied')
    )
  }

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
            <div className="hive-account-popover-header">
              <button
                type="button"
                className="hive-account-popover-identity"
                onClick={openAccountCenter}
                aria-label={translate(
                  'components.sidebarAccount.openCenter',
                  'Open account center'
                )}
              >
                <span className="hive-account-popover-avatar">
                  <img src={accountMascot} alt="" aria-hidden="true" />
                </span>
                <span className="hive-account-popover-identity-copy">
                  <strong>
                    {connected
                      ? accountDisplayName
                      : translate('components.sidebarAccount.localMode', 'Local mode')}
                  </strong>
                  <span>
                    {connected
                      ? translate('components.sidebarAccount.cloudAccount', 'HiveCloud account')
                      : translate(
                          'components.sidebarAccount.localWorkspace',
                          'HiveCode local workspace'
                        )}
                  </span>
                  <em>
                    {connected
                      ? translate(
                          'components.sidebarAccount.workAccount',
                          'HiveKernel · Work account'
                        )
                      : translate(
                          'components.sidebarAccount.notConnected',
                          'Cloud account not connected'
                        )}
                  </em>
                </span>
              </button>
              {connected ? (
                <button
                  type="button"
                  className="hive-account-icon-button"
                  aria-label={translate(
                    'components.sidebarAccount.copyAccount',
                    'Copy account information'
                  )}
                  data-tooltip={translate(
                    'components.sidebarAccount.copyAccount',
                    'Copy account information'
                  )}
                  onClick={copyAccountName}
                >
                  <Copy className="size-4" />
                </button>
              ) : null}
            </div>

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
              <DropdownMenuItem className="hive-account-menu-item" onSelect={openAccountCenter}>
                <UserRound className="hive-account-menu-icon" />
                <span>
                  {translate('components.sidebarAccount.accountCenter', 'Account center')}
                </span>
                <ChevronRight className="hive-account-menu-chevron" />
              </DropdownMenuItem>
              <DropdownMenuItem className="hive-account-menu-item" onSelect={openAccountCenter}>
                <Cloud className="hive-account-menu-icon" />
                <span>
                  {translate('components.sidebarAccount.cloudConnection', 'HiveCloud connection')}
                </span>
                <span className={`hive-account-menu-value ${accountStatusTone}`}>
                  <span className="hive-account-status-dot" aria-hidden="true" />
                  {accountStatusLabel}
                </span>
                <ChevronRight className="hive-account-menu-chevron" />
              </DropdownMenuItem>
              {connected ? (
                <>
                  <DropdownMenuItem className="hive-account-menu-item" onSelect={openAccountCenter}>
                    <MonitorSmartphone className="hive-account-menu-icon" />
                    <span>
                      {translate(
                        'components.sidebarAccount.devicesSessions',
                        'Devices and sessions'
                      )}
                    </span>
                    <span className="hive-account-menu-value">
                      {translate('components.sidebarAccount.viewDetails', 'View details')}
                    </span>
                    <ChevronRight className="hive-account-menu-chevron" />
                  </DropdownMenuItem>
                  <DropdownMenuItem className="hive-account-menu-item" onSelect={openAccountCenter}>
                    <Database className="hive-account-menu-icon" />
                    <span>
                      {translate(
                        'components.sidebarAccount.storageResources',
                        'Storage and resources'
                      )}
                    </span>
                    <span className="hive-account-menu-value">
                      {translate('components.sidebarAccount.viewDetails', 'View details')}
                    </span>
                    <ChevronRight className="hive-account-menu-chevron" />
                  </DropdownMenuItem>
                </>
              ) : null}
            </div>

            <div className="hive-account-menu-group">
              <DropdownMenuItem
                className="hive-account-menu-item"
                onSelect={() => openSettingsPane('appearance')}
              >
                <Settings className="hive-account-menu-icon" />
                <span>{translate('components.sidebarAccount.settings', 'Settings')}</span>
                <ChevronRight className="hive-account-menu-chevron" />
              </DropdownMenuItem>
              <div className="hive-account-menu-item hive-account-theme-row">
                <Sun className="hive-account-menu-icon" />
                <span>{translate('components.sidebarAccount.appearance', 'Appearance')}</span>
                <div
                  className="hive-account-theme-switch"
                  role="group"
                  aria-label={translate('components.sidebarAccount.theme', 'Theme')}
                >
                  {(['system', 'light', 'dark'] as const).map((theme) => (
                    <button
                      type="button"
                      key={theme}
                      className={activeTheme === theme ? 'is-active' : ''}
                      onClick={() => void updateSettings({ theme })}
                    >
                      {translate(
                        `components.sidebarAccount.theme${theme[0].toUpperCase()}${theme.slice(1)}`,
                        theme
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <DropdownMenuItem className="hive-account-menu-item" onSelect={openNotifications}>
                <Bell className="hive-account-menu-icon" />
                <span>{translate('components.sidebarAccount.notifications', 'Notifications')}</span>
                <span className="hive-account-menu-value">
                  {translate('components.sidebarAccount.noUnread', 'No unread')}
                </span>
                <ChevronRight className="hive-account-menu-chevron" />
              </DropdownMenuItem>
              <DropdownMenuItem className="hive-account-menu-item">
                <CircleHelp className="hive-account-menu-icon" />
                <span>
                  {translate('components.sidebarAccount.helpFeedback', 'Help and feedback')}
                </span>
                <ChevronRight className="hive-account-menu-chevron" />
              </DropdownMenuItem>
              <DropdownMenuItem className="hive-account-menu-item">
                <RefreshCw className="hive-account-menu-icon" />
                <span>
                  {translate('components.sidebarAccount.checkUpdates', 'Check for updates')}
                </span>
                <span className="hive-account-menu-value">
                  {translate('components.sidebarAccount.upToDate', 'Up to date')}
                </span>
                <ChevronRight className="hive-account-menu-chevron" />
              </DropdownMenuItem>
            </div>

            {connected ? (
              <div className="hive-account-menu-group hive-account-danger-group">
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
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="relative shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant={activeView === 'mobile' ? 'secondary' : 'ghost'}
                      size="icon-sm"
                      className="text-muted-foreground"
                      aria-label={translate(
                        'auto.components.sidebar.SidebarNav.1b5c41caee',
                        'Orca Mobile'
                      )}
                      aria-current={activeView === 'mobile' ? 'page' : undefined}
                      onClick={() => {
                        mobileOnboardingBadge.dismiss()
                        openMobilePage()
                      }}
                    >
                      <MonitorSmartphone className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4}>
                    {translate('auto.components.sidebar.SidebarNav.1b5c41caee', 'Orca Mobile')}
                  </TooltipContent>
                </Tooltip>
                {mobileOnboardingBadge.visible ? (
                  <span
                    className={cn(
                      'pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary',
                      activeView === 'mobile' && 'bg-primary-foreground'
                    )}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            </ContextMenuTrigger>
            <HideSidebarMenu onHide={hideMobileButton} />
          </ContextMenu>
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
    </>
  )
})

export default SidebarFooter
