import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import type { TerminalTab } from '../../../shared/terminal-tab-types'
import { useAppStore } from '../store'
import { useWorktreeMap } from '../store/selectors'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import type { WorktreeTabBucketProjection } from '@/lib/worktree-tab-bucket-projection'
import { projectWorkspaceSurfaces } from './workspace-surface-projection'
import { useReusedArrayIdentity } from './sidebar/worktree-list/listing/use-reused-array-identity'
import { selectPairedRuntimeParkingEnvironmentIds } from './terminal-pane/terminal-hidden-view-parking'
import { createTerminalWorktreeTopologyProjection } from './terminal-pane/terminal-hidden-worktree-retention'
import { isMainTerminalSideEffectAuthorityForPty } from './terminal-pane/terminal-side-effect-facts-handler'
import { isFloatingTerminalWorkspaceId } from '@/lib/floating-terminal'
import { resolveActiveFloatingWorkspaceSurface } from '@/lib/floating-workspace-surface-ownership'

export function useTerminalWorkspaceFoundation() {
  const terminalTopologyProjectionRef = useRef<WorktreeTabBucketProjection<
    TerminalTab,
    TerminalTab
  > | null>(null)
  terminalTopologyProjectionRef.current ??= createTerminalWorktreeTopologyProjection()
  const mountedWorktreeIdsRef = useRef(new Set<string>())
  const browserGuestWorktreeRecencyRef = useRef<string[]>([])
  const measurableBackgroundWorktreeIdsRef = useRef(new Set<string>())
  const terminalWorktreeHiddenSinceRef = useRef(new Map<string, number>())
  const measuringTerminalWorktreeIdsRef = useRef(new Set<string>())
  const terminalWorktreeParkCooldownUntilRef = useRef(new Map<string, number>())
  const terminalWorktreeParkingTimersRef = useRef(new Map<string, number>())
  const worktreesById = useWorktreeMap()
  const folderWorkspaces = useAppStore((state) => state.folderWorkspaces)
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const activeView = useAppStore((state) => state.activeView)
  const floatingWorkspaceIds = useAppStore(
    useShallow((state) =>
      state.activeView === 'sessions'
        ? [
            ...new Set([
              ...Object.keys(state.tabsByWorktree),
              ...Object.keys(state.unifiedTabsByWorktree)
            ])
          ].filter(isFloatingTerminalWorkspaceId)
        : isFloatingTerminalWorkspaceId(state.activeWorktreeId)
          ? [state.activeWorktreeId!]
          : []
    )
  )
  const needsLocalFloatingCwd = floatingWorkspaceIds.includes(FLOATING_TERMINAL_WORKTREE_ID)
  const floatingTerminalCwd = useAppStore((state) => state.settings?.floatingTerminalCwd ?? '')
  const [floatingCwdResolution, setFloatingCwdResolution] = useState<{
    requestedPath: string
    cwd: string
  } | null>(null)
  const resolvedFloatingTerminalCwd =
    needsLocalFloatingCwd && floatingCwdResolution?.requestedPath === floatingTerminalCwd
      ? floatingCwdResolution.cwd
      : null
  useEffect(() => {
    if (!needsLocalFloatingCwd) {
      return
    }
    let cancelled = false
    void window.api.app
      .getFloatingTerminalCwd({ path: floatingTerminalCwd })
      .then((cwd) => {
        if (!cancelled) {
          setFloatingCwdResolution({ requestedPath: floatingTerminalCwd, cwd })
        }
      })
      .catch((error) => {
        console.error('Could not resolve the temporary-session directory', error)
      })
    return () => {
      cancelled = true
    }
  }, [needsLocalFloatingCwd, floatingTerminalCwd])
  const renderedActiveWorktreeId = activeWorktreeId
  const activeWorktreeDeferralHostId = useAppStore((state) =>
    getResolvedExecutionHostIdForWorktree(state, renderedActiveWorktreeId)
  )
  // Why narrow it: only the folder-collision tie-break reads this host, so a git
  // workspace's ownership settling must not re-identify the whole mount projection.
  const activeFolderSurfaceHostId =
    parseWorkspaceKey(renderedActiveWorktreeId ?? '')?.type === 'folder'
      ? activeWorktreeDeferralHostId
      : null
  const workspaceSurfaces = useMemo(() => {
    const surfaces = projectWorkspaceSurfaces({
      worktreesById,
      folderWorkspaces,
      activeWorkspaceId: renderedActiveWorktreeId,
      activeWorkspaceResolvedHostId: activeFolderSurfaceHostId
    })
    const floatingSurfaces = floatingWorkspaceIds.flatMap((id) => {
      const surface = resolveActiveFloatingWorkspaceSurface(
        id,
        id === FLOATING_TERMINAL_WORKTREE_ID ? resolvedFloatingTerminalCwd : null
      )
      return surface && !surfaces.some((entry) => entry.id === id) ? [surface] : []
    })
    return [...surfaces, ...floatingSurfaces]
  }, [
    floatingWorkspaceIds,
    activeFolderSurfaceHostId,
    folderWorkspaces,
    renderedActiveWorktreeId,
    resolvedFloatingTerminalCwd,
    worktreesById
  ])
  // Why split the ids out: every mount/park/activation pass reads only `.id`, but
  // the surface array is re-identified on any worktree write. Reusing the previous
  // id-array identity keeps those effects and their per-fire Sets from re-firing
  // when the workspace set itself did not change.
  const workspaceSurfaceIds = useReusedArrayIdentity(
    useMemo(() => workspaceSurfaces.map((workspace) => workspace.id), [workspaceSurfaces])
  )
  const workspaceSurfaceIdSet = useMemo<ReadonlySet<string>>(
    () => new Set(workspaceSurfaceIds),
    [workspaceSurfaceIds]
  )
  // Why: terminal titles are leaf chrome. The root host only subscribes to
  // mount/parking semantics; a real transition publishes fresh tab objects,
  // while LiveTerminalTabBar reads title-only updates from the active bucket.
  const tabsByWorktree = useAppStore((state) =>
    terminalTopologyProjectionRef.current!.project(state.tabsByWorktree)
  )
  const pendingStartupByTabId = useAppStore((state) => state.pendingStartupByTabId)
  const terminalParkingEnabled = useAppStore(
    (state) => state.settings?.terminalHiddenViewParking !== false
  )
  const terminalSshParkingEnabled = useAppStore(
    (state) => state.settings?.terminalSshViewParking !== false
  )
  const runtimeStatusByEnvironmentId = useAppStore((state) => state.runtimeStatusByEnvironmentId)
  const pairedRuntimeParkingEnvironmentIds = useMemo(
    () => selectPairedRuntimeParkingEnvironmentIds(runtimeStatusByEnvironmentId),
    [runtimeStatusByEnvironmentId]
  )
  const terminalRetentionBudgetEnabled = useAppStore(
    (state) => state.settings?.terminalHiddenWorktreeRetentionBudget !== false
  )
  const browserGuestRetentionBudgetEnabled = useAppStore(
    (state) => state.settings?.browserGuestWorktreeRetentionBudget !== false
  )
  const terminalTitleSnapshotAuthorityEnabled = useAppStore((state) =>
    isMainTerminalSideEffectAuthorityForPty({
      settings: state.settings,
      runtimeEnvironmentId: null
    })
  )

  return {
    mountedWorktreeIdsRef,
    browserGuestWorktreeRecencyRef,
    measurableBackgroundWorktreeIdsRef,
    terminalWorktreeHiddenSinceRef,
    measuringTerminalWorktreeIdsRef,
    terminalWorktreeParkCooldownUntilRef,
    terminalWorktreeParkingTimersRef,
    folderWorkspaces,
    workspaceSurfaces,
    workspaceSurfaceIds,
    workspaceSurfaceIdSet,
    activeWorktreeId,
    renderedActiveWorktreeId,
    activeWorktreeDeferralHostId,
    activeView,
    tabsByWorktree,
    pendingStartupByTabId,
    terminalParkingEnabled,
    terminalSshParkingEnabled,
    runtimeStatusByEnvironmentId,
    pairedRuntimeParkingEnvironmentIds,
    terminalRetentionBudgetEnabled,
    browserGuestRetentionBudgetEnabled,
    terminalTitleSnapshotAuthorityEnabled
  }
}

export type TerminalWorkspaceFoundation = ReturnType<typeof useTerminalWorkspaceFoundation>
