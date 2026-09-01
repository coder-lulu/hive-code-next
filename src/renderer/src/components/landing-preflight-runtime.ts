import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../store'
import {
  getLandingPreflightIssues,
  hasGitHubBackedProject,
  type PreflightIssue
} from './landing-preflight-issues'

export function useLandingPreflightRuntime(): { preflightIssues: PreflightIssue[] } {
  const repos = useAppStore((s) => s.repos)
  const preflightStatus = useAppStore((s) => s.preflightStatus)
  const refreshPreflightStatus = useAppStore((s) => s.refreshPreflightStatus)
  const invalidatePreflightStatus = useAppStore((s) => s.invalidatePreflightStatus)
  const activeRuntimeState = useAppStore((s) => {
    if (!s.settings) {
      return 'settings-pending'
    }
    const environmentId = s.settings?.activeRuntimeEnvironmentId?.trim()
    if (!environmentId) {
      return 'local'
    }
    const runtimeStatus = s.runtimeStatusByEnvironmentId.get(environmentId)
    const reachability = runtimeStatus
      ? runtimeStatus.status === null
        ? 'unreachable'
        : 'reachable'
      : 'unknown'
    return `${environmentId}:${runtimeStatus?.connectionGeneration ?? 0}:${reachability}`
  })

  const hasGitHubProject = useMemo(() => hasGitHubBackedProject(repos), [repos])
  const preflightIssues = useMemo(
    () =>
      preflightStatus
        ? getLandingPreflightIssues(preflightStatus, {
            hasGitHubBackedProject: hasGitHubProject
          })
        : [],
    [preflightStatus, hasGitHubProject]
  )

  useEffect(() => {
    if (activeRuntimeState === 'settings-pending') {
      invalidatePreflightStatus()
      return
    }
    if (activeRuntimeState !== 'local' && !activeRuntimeState.endsWith(':reachable')) {
      invalidatePreflightStatus()
      return
    }

    void refreshPreflightStatus()
    const handleWindowActive = (): void => {
      if (document.visibilityState === 'visible') {
        void refreshPreflightStatus({ force: true })
      }
    }
    document.addEventListener('visibilitychange', handleWindowActive)
    window.addEventListener('focus', handleWindowActive)
    return () => {
      document.removeEventListener('visibilitychange', handleWindowActive)
      window.removeEventListener('focus', handleWindowActive)
    }
  }, [activeRuntimeState, invalidatePreflightStatus, refreshPreflightStatus])

  useEffect(() => {
    if (preflightIssues.length === 0) {
      return
    }
    const intervalId = window.setInterval(() => {
      void refreshPreflightStatus({ force: true })
    }, 30000)
    return () => window.clearInterval(intervalId)
  }, [preflightIssues.length, refreshPreflightStatus])

  return { preflightIssues }
}

const STARTUP_PREFLIGHT_TOAST_PREFIX = 'startup-preflight:'

function startupPreflightToastId(issueId: string): string {
  return `${STARTUP_PREFLIGHT_TOAST_PREFIX}${issueId}`
}

/**
 * Keeps prerequisite checks alive for the entire app session and reports setup
 * problems without reserving permanent space on the home screen.
 */
export function useStartupPreflightNotifications(): void {
  const { preflightIssues } = useLandingPreflightRuntime()
  const notifiedIssueIds = useRef(new Set<string>())
  const activeIssueIds = useRef(new Set<string>())

  useEffect(() => {
    const nextActiveIssueIds = new Set(preflightIssues.map((issue) => issue.id))

    for (const issueId of activeIssueIds.current) {
      if (!nextActiveIssueIds.has(issueId)) {
        toast.dismiss(startupPreflightToastId(issueId))
      }
    }

    for (const issue of preflightIssues) {
      if (notifiedIssueIds.current.has(issue.id)) {
        continue
      }

      notifiedIssueIds.current.add(issue.id)
      toast.warning(issue.title, {
        id: startupPreflightToastId(issue.id),
        description: issue.description,
        duration: issue.dismissible ? 12000 : Infinity,
        action: {
          label: issue.fixLabel,
          onClick: () => void window.api.shell.openUrl(issue.fixUrl)
        }
      })
    }

    activeIssueIds.current = nextActiveIssueIds
  }, [preflightIssues])
}
