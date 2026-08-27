/* eslint-disable max-lines -- Keeps account state, sign-in methods, and the sidebar action surface synchronized. */

import React from 'react'
import { Bell, Check, LogIn, LogOut, MonitorSmartphone, Palette, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { APP_DISPLAY_NAME, PRODUCT_LOGO_URL } from '@/product-brand'
import { useAppStore } from '@/store'
import type { HiveAccountSignInOptions, HiveAccountState } from '../../../../shared/hive-account'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { HideSidebarMenu } from './sidebar-nav-controls'
import { useMobileSidebarOnboardingBadge } from './mobile-sidebar-onboarding-badge'
import { shouldShowAgentsButton, shouldShowMobileButton } from './SidebarNav'
import { HiveAccountSignInConfirmDialog } from '../settings/HiveAccountSignInConfirmDialog'
import { HiveAccountSignOutConfirmDialog } from '../settings/HiveAccountSignOutConfirmDialog'

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
          translate('auto.components.sidebar.SidebarFooter.signInSuccess', 'Signed in to HiveCloud')
        )
      } else if (result.status === 'failed') {
        toast.error(
          translate(
            'auto.components.sidebar.SidebarFooter.signInFailed',
            'HiveCloud sign-in failed. Try again or check the service status.'
          )
        )
      }
    } catch {
      toast.error(
        translate(
          'auto.components.sidebar.SidebarFooter.signInFailed',
          'HiveCloud sign-in failed. Try again or check the service status.'
        )
      )
    } finally {
      setSigningIn(false)
    }
  }

  const startSmsSignIn = (
    phoneNumber: string,
    sessionProfile: HiveAccountSignInOptions['sessionProfile']
  ) => {
    if (!window.api.hiveAccount.startSmsSignIn) {
      return Promise.reject(new Error('sms_sign_in_unavailable'))
    }
    return window.api.hiveAccount.startSmsSignIn({
      phoneNumber,
      sessionProfile,
      termsAccepted: true
    })
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
          translate('auto.components.sidebar.SidebarFooter.signInSuccess', 'Signed in to HiveCloud')
        )
      } else if (result.status === 'failed') {
        toast.error(
          translate(
            'auto.components.sidebar.SidebarFooter.signInFailed',
            'HiveCloud sign-in failed. Try again or check the service status.'
          )
        )
      }
    } catch {
      toast.error(
        translate(
          'auto.components.sidebar.SidebarFooter.signInFailed',
          'HiveCloud sign-in failed. Try again or check the service status.'
        )
      )
    } finally {
      setSigningIn(false)
    }
  }

  const signInLabel =
    accountState === null
      ? translate('auto.components.sidebar.SidebarFooter.checkingAccount', 'Checking account…')
      : accountState.status === 'unconfigured' || secureStorageBlocked
        ? translate(
            'auto.components.sidebar.SidebarFooter.accountUnavailable',
            'Account unavailable'
          )
        : accountState.status === 'error'
          ? translate('auto.components.sidebar.SidebarFooter.signInAgain', 'Sign in again')
          : translate('auto.components.sidebar.SidebarFooter.signIn', 'Sign in')

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
            'auto.components.sidebar.SidebarFooter.localSignOut',
            'Signed out locally. Revoke the remote session from HiveCloud Security when online.'
          )
        )
      } else {
        toast.success(
          translate(
            'auto.components.sidebar.SidebarFooter.signOutSuccess',
            'Signed out of HiveCloud'
          )
        )
      }
    } catch {
      toast.error(
        translate(
          'auto.components.sidebar.SidebarFooter.signOutFailed',
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

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-t border-worktree-sidebar-border px-2 py-1.5">
        {connected ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md bg-transparent px-2 text-left text-worktree-sidebar-foreground transition-colors hover:bg-worktree-sidebar-foreground/7 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-worktree-sidebar-ring/50"
                aria-label={translate(
                  'auto.components.sidebar.SidebarFooter.accountMenu',
                  '{{value0}} account menu',
                  { value0: accountState.account?.displayName || APP_DISPLAY_NAME }
                )}
                data-account-status="signed-in"
                data-sidebar-account-trigger=""
              >
                <img
                  src={PRODUCT_LOGO_URL}
                  alt=""
                  aria-hidden="true"
                  data-account-avatar=""
                  className="size-5 shrink-0 rounded-md object-contain"
                />
                <span className="flex min-w-0 flex-1 flex-col leading-none">
                  <span className="truncate text-[13px] font-semibold">
                    {accountState.account?.displayName || APP_DISPLAY_NAME}
                  </span>
                  <span className="mt-1 flex items-center gap-1 truncate text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="size-2.5" />
                    {translate('auto.components.sidebar.SidebarFooter.connected', 'Signed in')}
                  </span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64">
              <DropdownMenuLabel className="flex items-center gap-2 px-2 py-2">
                <img
                  src={PRODUCT_LOGO_URL}
                  alt=""
                  aria-hidden="true"
                  className="size-6 rounded-md object-contain"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">
                    {accountState.account?.displayName || APP_DISPLAY_NAME}
                  </span>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {translate('auto.components.sidebar.SidebarFooter.connected', 'Signed in')}
                  </span>
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openSettingsPane('orca-account')}>
                <UserRound className="size-3.5" />
                {translate('auto.components.sidebar.SidebarFooter.account', 'Account')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openSettingsPane('appearance')}>
                <Palette className="size-3.5" />
                {translate('auto.components.sidebar.SidebarFooter.appearance', 'Appearance')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setSignOutOpen(true)}>
                <LogOut className="size-3.5" />
                {translate('auto.components.sidebar.SidebarFooter.signOut', 'Sign out')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md bg-transparent px-2 text-left text-[12px] font-semibold text-worktree-sidebar-foreground/85 transition-colors hover:bg-worktree-sidebar-foreground/7 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-worktree-sidebar-ring/50 disabled:cursor-wait disabled:opacity-70"
            aria-label={signInLabel}
            data-account-status="signed-out"
            data-sidebar-account-trigger=""
            disabled={accountState === null}
            onClick={requestSignIn}
          >
            <img
              src={PRODUCT_LOGO_URL}
              alt=""
              aria-hidden="true"
              className="size-5 shrink-0 rounded-md object-contain"
            />
            <span className="truncate">{signInLabel}</span>
            <LogIn className="ml-auto size-3.5 shrink-0 text-worktree-sidebar-foreground/55" />
          </button>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={activeView === 'activity' ? 'secondary' : 'ghost'}
              size="icon-sm"
              className="relative shrink-0 text-muted-foreground"
              aria-label={
                showActivity
                  ? translate('auto.components.sidebar.SidebarFooter.activity', 'Activity')
                  : translate(
                      'auto.components.sidebar.SidebarFooter.notifications',
                      'Notifications'
                    )
              }
              onClick={openNotifications}
            >
              <Bell className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {showActivity
              ? translate('auto.components.sidebar.SidebarFooter.activity', 'Activity')
              : translate('auto.components.sidebar.SidebarFooter.notifications', 'Notifications')}
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
