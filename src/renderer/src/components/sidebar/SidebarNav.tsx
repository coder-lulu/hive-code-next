import { TitlebarSearchButton } from '@/app-shell/TitlebarSearchButton'
import { Button } from '@/components/ui/button'
import React from 'react'
import {
  Bell,
  BookOpen,
  CalendarClock,
  Files,
  FolderClosed,
  MessageSquarePlus,
  Smartphone
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { useActivityUnreadCount } from '@/components/activity/useActivityUnreadCount'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { useMobileSidebarOnboardingBadge } from './mobile-sidebar-onboarding-badge'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { SetupGuideSidebarEntry } from './SetupGuideSidebarEntry'
import { SidebarTaskNavButton } from './SidebarTaskNavButton'
import SidebarSessionsNavButton from './SidebarSessionsNavButton'
import { HideSidebarMenu } from './sidebar-nav-controls'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { shouldShowMobileButton, useHiveAccountState } from '@/hooks/use-hive-account-state'
export { shouldShowMobileButton } from '@/hooks/use-hive-account-state'

export { getSetupGuideSidebarEntryReady, shouldShowSetupGuideEntry } from './SetupGuideSidebarEntry'

export function shouldShowAgentsButton(
  settings: Partial<Pick<GlobalSettings, 'experimentalActivity'>> | null | undefined
): boolean {
  return settings?.experimentalActivity === true
}

export function shouldShowAutomationsButton(
  settings: Partial<Pick<GlobalSettings, 'showAutomationsButton'>> | null | undefined
): boolean {
  return settings?.showAutomationsButton !== false
}

export function shouldShowArtifactsButton(
  settings: Partial<Pick<GlobalSettings, 'showArtifactsButton'>> | null | undefined
): boolean {
  return settings?.showArtifactsButton === true
}

export function shouldShowSkillsButton(
  settings: Partial<Pick<GlobalSettings, 'showSkillsButton'>> | null | undefined
): boolean {
  return settings?.showSkillsButton === true
}

const SidebarNav = React.memo(function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  // Why: this memo boundary needs its own language subscription, while
  // translate() preserves Orca's pseudo-localization behavior.
  useTranslation()
  const newTaskShortcutLabel = useShortcutLabel('home.newTask')
  const openNewTaskHome = useAppStore((s) => s.openNewTaskHome)
  const openSessionsPage = useAppStore((s) => s.openSessionsPage)
  const updateSessionsView = useAppStore((s) => s.updateSessionsView)
  const newTaskActive = useAppStore(
    (s) => s.homeNewTaskMode && s.activeView === 'terminal' && s.activeWorkspaceKey === null
  )
  const openAutomationsPage = useAppStore((s) => s.openAutomationsPage)
  const openActivityPage = useAppStore((s) => s.openActivityPage)
  const openDeviceConnectionsPage = useAppStore((s) => s.openDeviceConnectionsPage)
  const openArtifactsPage = useAppStore((s) => s.openArtifactsPage)
  const openSkillsPage = useAppStore((s) => s.openSkillsPage)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const activeView = useAppStore((s) => s.activeView)
  const projectManagementActive = useAppStore(
    (s) =>
      (s.activeView === 'sessions' ||
        (s.activeView === 'terminal' &&
          Boolean(s.activeWorktreeId || s.activePendingCreationId))) &&
      s.sessionsView.navigation === 'projects'
  )
  const showAgentsButton = useAppStore((s) => shouldShowAgentsButton(s.settings))
  const { state: accountState } = useHiveAccountState()
  const showMobileButton = shouldShowMobileButton(accountState)
  const showAutomationsButton = useAppStore((s) => shouldShowAutomationsButton(s.settings))
  const showArtifactsButton = useAppStore((s) => shouldShowArtifactsButton(s.settings))
  const showSkillsButton = useAppStore((s) => shouldShowSkillsButton(s.settings))
  const automationsActive = activeView === 'automations'
  const activityActive = activeView === 'activity'
  const artifactsActive = activeView === 'artifacts'
  const skillsActive = activeView === 'skills'
  const activityUnreadCount = useActivityUnreadCount(showAgentsButton, 'sidebar-badge')
  const mobileActive = activeView === 'device-connections'
  const mobileOnboardingBadge = useMobileSidebarOnboardingBadge(showMobileButton)
  const hideAutomationsButton = React.useCallback(() => {
    void updateSettings({ showAutomationsButton: false })
  }, [updateSettings])
  const hideArtifactsButton = React.useCallback(() => {
    void updateSettings({ showArtifactsButton: false })
  }, [updateSettings])
  const hideSkillsButton = React.useCallback(() => {
    void updateSettings({ showSkillsButton: false })
  }, [updateSettings])

  return (
    <div
      className="sidebar-primary-nav flex flex-col gap-0.5 px-2 pt-2 pb-2"
      aria-label={translate('components.sidebar.primaryNavigation', 'Primary navigation')}
      data-contextual-tour-target="sidebar-navigation"
      onClickCapture={onNavigate}
    >
      <div className="mb-1">
        <TitlebarSearchButton placement="sidebar" />
      </div>
      <button
        type="button"
        className={cn('sidebar-new-task-button', newTaskActive && 'is-active')}
        onClick={openNewTaskHome}
        aria-current={newTaskActive ? 'page' : undefined}
        aria-label={translate('components.sidebar.newTask', 'New task')}
        title={translate('components.sidebar.newTaskWithShortcut', 'New task ({{shortcut}})', {
          shortcut: newTaskShortcutLabel
        })}
      >
        <MessageSquarePlus className="size-4" strokeWidth={1.9} />
        <span className="flex-1">{translate('components.sidebar.newTask', 'New task')}</span>
        <span className="sidebar-new-task-shortcut">{newTaskShortcutLabel}</span>
      </button>
      <SidebarSessionsNavButton />
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'w-full justify-start gap-2 px-2 text-[13px]',
          projectManagementActive
            ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
            : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
        )}
        aria-current={projectManagementActive ? 'page' : undefined}
        onClick={() => {
          openSessionsPage()
          updateSessionsView({ navigation: 'projects', query: '' })
        }}
      >
        <FolderClosed className="size-4 shrink-0" />
        {translate('components.sessions.projectNavigation', 'Projects')}
      </Button>
      <SetupGuideSidebarEntry />
      <SidebarTaskNavButton />
      {showArtifactsButton ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={openArtifactsPage}
              aria-current={artifactsActive ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
                artifactsActive
                  ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
                  : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
              )}
            >
              <Files
                className={cn(
                  'size-4 shrink-0',
                  !artifactsActive && 'text-worktree-sidebar-foreground/30'
                )}
                strokeWidth={artifactsActive ? 2.25 : 1.75}
              />
              <span className="flex-1">
                {translate('auto.components.sidebar.SidebarNav.artifacts', 'Artifacts')}
              </span>
            </button>
          </ContextMenuTrigger>
          <HideSidebarMenu onHide={hideArtifactsButton} />
        </ContextMenu>
      ) : null}
      {showSkillsButton ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={openSkillsPage}
              aria-current={skillsActive ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
                skillsActive
                  ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
                  : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
              )}
            >
              <BookOpen
                className={cn(
                  'size-4 shrink-0',
                  !skillsActive && 'text-worktree-sidebar-foreground/30'
                )}
                strokeWidth={skillsActive ? 2.25 : 1.75}
              />
              <span className="flex-1">
                {translate('auto.components.sidebar.SidebarNav.skills', 'Skills')}
              </span>
            </button>
          </ContextMenuTrigger>
          <HideSidebarMenu onHide={hideSkillsButton} />
        </ContextMenu>
      ) : null}
      {showAutomationsButton ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={openAutomationsPage}
              aria-current={automationsActive ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
                automationsActive
                  ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
                  : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
              )}
            >
              <CalendarClock
                className={cn(
                  'size-4 shrink-0',
                  !automationsActive && 'text-worktree-sidebar-foreground/30'
                )}
                strokeWidth={automationsActive ? 2.25 : 1.75}
              />
              <span className="flex-1">
                {translate('auto.components.sidebar.SidebarNav.f323383e9a', 'Automations')}
              </span>
            </button>
          </ContextMenuTrigger>
          <HideSidebarMenu onHide={hideAutomationsButton} />
        </ContextMenu>
      ) : null}
      {showAgentsButton ? (
        <button
          type="button"
          onClick={() => openActivityPage()}
          aria-current={activityActive ? 'page' : undefined}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
            activityActive
              ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
              : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
          )}
        >
          <Bell
            className={cn(
              'size-4 shrink-0',
              !activityActive && 'text-worktree-sidebar-foreground/30'
            )}
            strokeWidth={activityActive ? 2.25 : 1.75}
          />
          <span className="flex-1">
            {translate('auto.components.sidebar.SidebarNav.9c95e1ce91', 'Agents')}
          </span>
          {activityUnreadCount > 0 ? (
            <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
              {activityUnreadCount}
            </span>
          ) : null}
        </button>
      ) : null}
      {showMobileButton ? (
        <button
          type="button"
          onClick={() => {
            mobileOnboardingBadge.dismiss()
            openDeviceConnectionsPage()
          }}
          aria-current={mobileActive ? 'page' : undefined}
          className={cn(
            'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
            mobileActive
              ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
              : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
          )}
        >
          <Smartphone
            className={cn(
              'size-4 shrink-0',
              !mobileActive && 'text-worktree-sidebar-foreground/30'
            )}
            strokeWidth={mobileActive ? 2.25 : 1.75}
          />
          <span className="min-w-0 flex-1 truncate">
            {translate('phoneConnection.title', 'Phone connection')}
          </span>
          {mobileOnboardingBadge.visible ? (
            <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
              {translate('auto.components.sidebar.SidebarNav.c86d83b5c3', 'New')}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  )
})

export default SidebarNav
