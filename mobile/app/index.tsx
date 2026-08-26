import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { View, Text, Pressable, FlatList, Alert } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { ChevronRight, Terminal, ListTodo } from 'lucide-react-native'
import { ClaudeIcon, OpenAIIcon } from '../src/components/AgentIcons'
import {
  type AccountsSnapshot,
  type ProviderKey,
  decodeAccountsSnapshot,
  getActiveProviderRateLimits,
  getUsageBarState,
  hasActiveProviderUsage,
  hasRenderableUsage,
  UsageBar
} from '../src/components/AccountUsage'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { loadHostCatalog } from '../src/transport/host-store'
import { selectConnectableHostProfiles } from '../src/transport/host-catalog-selection'
import { useOpenMobileHostEdit } from '../src/transport/use-open-mobile-host-edit'
import { removeHostAndCloseClient } from '../src/transport/host-removal-lifecycle'
import { fetchHomeHostWorktreeInfo } from '../src/worktree/home-host-worktree-fetch'
import { totalHomeStats, type HomeStatsSummary } from '../src/stats/home-stats-total'
import type { HomeWorktreeSummary, HostWorktreeInfo } from '../src/worktree/home-worktree-info'
import type { RpcClient } from '../src/transport/rpc-client'
import { createHostConnectRefetchGate } from '../src/transport/host-connect-refetch-gate'
import { sendSingleFlightRequest } from '../src/transport/request-single-flight'
import {
  useDisconnectHostClient,
  useForceReconnect,
  useForgetHostClient,
  usePrimeHosts
} from '../src/transport/client-context'
import { useAllHostClients } from '../src/transport/use-all-host-clients'
import {
  resolveHomeHostConnectionState,
  selectHomeAutoConnectHostIds
} from '../src/transport/home-host-auto-connect'
import { classifyConnection } from '../src/transport/connection-health'
import { subscribeToDesktopNotifications } from '../src/notifications/mobile-notifications'
import {
  loadMobileOnboardingSteps,
  mobileOnboardingDestination
} from '../src/onboarding/mobile-onboarding-plan'
import type { ConnectionState, HostCatalogEntry, HostProfile } from '../src/transport/types'
import { triggerMediumImpact } from '../src/platform/haptics'
import { MobileHostCard } from '../src/components/MobileHostCard'
import { MobileHomeQuickActions } from '../src/components/MobileHomeQuickActions'
import { TaskProviderLogo } from '../src/components/TaskProviderLogo'
import { ActionSheetModal } from '../src/components/ActionSheetModal'
import { getHostListActionSheetActions } from '../src/host-list-action-sheet-actions'
import { ConfirmModal } from '../src/components/ConfirmModal'
import {
  setCachedWorktrees,
  getCachedWorktrees,
  getProvenCachedWorktrees
} from '../src/cache/worktree-cache'
import {
  LAST_VISITED_WORKTREE_STORAGE_KEY,
  readLastVisitedWorktreeRecord
} from '../src/worktree/last-visited-worktree-repo'
import { loadHomeSnapshot, saveHomeSnapshot } from '../src/cache/home-snapshot-cache'
import {
  filterAvailableTaskProviders,
  normalizeVisibleTaskProviders,
  type TaskProvider
} from '../src/tasks/mobile-task-providers'
import { useOpenMobileTasks } from '../src/tasks/use-open-mobile-tasks'
import { useResponsiveLayout } from '../src/layout/responsive-layout'
import { useOpenMobileSession } from '../src/session/use-open-mobile-session'
import { useOpenMobileAccounts } from '../src/accounts/use-open-mobile-accounts'
import {
  isResumeTargetConfirmedMissing,
  selectHomeResumeCard,
  type HomeResumeCard
} from '../src/worktree/home-resume-card'
import { hostRouteWithNotice } from '../src/host-route-notice'
import { hostNewWorktreeRoute } from '../src/host-route-action-state'
import { hostEndpointLabel } from '../src/transport/host-endpoint-label'
import { useMobileTheme } from '../src/theme/mobile-theme-provider'
import { MobileCloudWorkPreview } from '../src/home/MobileCloudWorkPreview'
import { MobileComputerEmptyState } from '../src/home/MobileComputerEmptyState'
import { MobileHomeDrawer } from '../src/home/MobileHomeDrawer'
import { MobileHomeToolbar } from '../src/home/MobileHomeToolbar'
import {
  loadInitialMobileHomeMode,
  persistMobileHomeMode,
  type MobileHomeMode
} from '../src/home/mobile-home-mode'
import { createMobileConnectedHomeStyles } from '../src/home/mobile-connected-home-styles'

type HomeTaskSettings = {
  visibleTaskProviders?: unknown
}

type HomePreflightStatus = {
  glab?: { installed?: boolean }
}

type HomeLinearStatus = {
  connected?: boolean
}

const TASK_PROVIDER_LABELS: Record<TaskProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear'
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  const minutes = totalMinutes % 60
  if (totalHours > 0) {
    return `${totalHours}h ${minutes}m`
  }
  return `${totalMinutes}m`
}

// Why: stable per-instance RpcClient identity so wireUp's dep key changes when forceReconnect swaps the client, re-attaching listeners.
const clientIdentities = new WeakMap<RpcClient, number>()
let nextClientIdentity = 1
function clientKey(client: RpcClient): number {
  let id = clientIdentities.get(client)
  if (id == null) {
    id = nextClientIdentity++
    clientIdentities.set(client, id)
  }
  return id
}

function fetchStats(
  client: RpcClient,
  hostId: string,
  setStats: (
    updater: (prev: Record<string, HomeStatsSummary>) => Record<string, HomeStatsSummary>
  ) => void,
  disposed: () => boolean
) {
  sendSingleFlightRequest(client, hostId, 'stats.summary')
    .then((response) => {
      if (disposed()) {
        return
      }
      if (response.ok) {
        // Keyed by host: the header totals every desktop instead of showing whoever replied last.
        setStats((prev) => ({ ...prev, [hostId]: response.result as HomeStatsSummary }))
      }
    })
    .catch(() => {})
}

function fetchAccountsSnapshot(
  client: RpcClient,
  hostId: string,
  setSnapshots: (
    updater: (prev: Record<string, AccountsSnapshot>) => Record<string, AccountsSnapshot>
  ) => void,
  disposed: () => boolean
) {
  sendSingleFlightRequest(client, hostId, 'accounts.list')
    .then((response) => {
      if (disposed()) {
        return
      }
      if (response.ok) {
        const snapshot = decodeAccountsSnapshot(response.result)
        setSnapshots((prev) => ({ ...prev, [hostId]: snapshot }))
      }
    })
    .catch(() => {})
}

function fetchTaskProviders(
  client: RpcClient,
  hostId: string,
  setProviders: (
    updater: (prev: Record<string, TaskProvider[]>) => Record<string, TaskProvider[]>
  ) => void,
  disposed: () => boolean
) {
  Promise.all([
    sendSingleFlightRequest(client, hostId, 'settings.get'),
    sendSingleFlightRequest(client, hostId, 'preflight.check'),
    sendSingleFlightRequest(client, hostId, 'linear.status')
  ])
    .then(([settingsResponse, preflightResponse, linearResponse]) => {
      if (disposed()) {
        return
      }
      const settings = settingsResponse.ok
        ? (((settingsResponse.result as { settings?: HomeTaskSettings }).settings ??
            {}) as HomeTaskSettings)
        : {}
      const preflight = preflightResponse.ok
        ? (preflightResponse.result as HomePreflightStatus)
        : null
      const linear = linearResponse.ok ? (linearResponse.result as HomeLinearStatus) : null
      const providers = filterAvailableTaskProviders(
        normalizeVisibleTaskProviders(settings.visibleTaskProviders),
        {
          gitlabInstalled: preflight?.glab?.installed === true,
          linearConnected: linear?.connected === true
        }
      )
      setProviders((prev) => ({ ...prev, [hostId]: providers }))
    })
    .catch(() => {
      if (disposed()) {
        return
      }
      setProviders((prev) => (prev[hostId] ? prev : { ...prev, [hostId]: ['github'] }))
    })
}

// Why: hash repo name to a stable color, matching the host detail page's dots.
const REPO_COLORS = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4']
function repoColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return REPO_COLORS[Math.abs(hash) % REPO_COLORS.length]
}

export default function HomeScreen() {
  const router = useRouter()
  const theme = useMobileTheme()
  const styles = useMemo(() => createMobileConnectedHomeStyles(theme), [theme])
  const openMobileHostEdit = useOpenMobileHostEdit()
  const openMobileTasks = useOpenMobileTasks()
  const openMobileSession = useOpenMobileSession()
  const openMobileAccounts = useOpenMobileAccounts()
  const insets = useSafeAreaInsets()
  // Why: cap/center content on wide/tablet canvases so cards don't stretch edge-to-edge on iPad.
  const { isWideLayout, contentMaxWidth } = useResponsiveLayout()
  const [hostCatalog, setHostCatalog] = useState<HostCatalogEntry[]>([])
  const [actionTarget, setActionTarget] = useState<HostProfile | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null)
  const [hostStates, setHostStates] = useState<Record<string, ConnectionState>>({})
  const [hostAttempts, setHostAttempts] = useState<Record<string, number>>({})
  const [hostLastConnected, setHostLastConnected] = useState<Record<string, number | null>>({})
  const [statsByHost, setStatsByHost] = useState<Record<string, HomeStatsSummary>>({})
  const [worktreeInfo, setWorktreeInfo] = useState<Record<string, HostWorktreeInfo>>({})
  const [accountsByHost, setAccountsByHost] = useState<Record<string, AccountsSnapshot>>({})
  const [taskProvidersByHost, setTaskProvidersByHost] = useState<Record<string, TaskProvider[]>>({})
  const [homeMode, setHomeMode] = useState<MobileHomeMode | null>(null)
  const [drawerVisible, setDrawerVisible] = useState(false)
  const [lastVisited, setLastVisited] = useState<{ hostId: string; worktreeId: string } | null>(
    null
  )
  // Why: focus can fire repeatedly while an async gate is pending; one probe per
  // mount avoids duplicate storage/permission reads and competing navigation.
  const onboardingOptInCheckedRef = useRef(false)
  const homeModeHydratedRef = useRef(false)

  // Why: shared clients from the per-host store, not N independent WebSockets. See docs/mobile-shared-client-per-host.md.
  const hosts = useMemo(() => selectConnectableHostProfiles(hostCatalog), [hostCatalog])
  const hostIds = useMemo(() => hosts.map((h) => h.id), [hosts])
  // Why: scoped to the paired hosts so an unpaired desktop's cached reply leaves the header total.
  const stats = useMemo(() => totalHomeStats(statsByHost, hostIds), [statsByHost, hostIds])
  const autoConnectHostIds = useMemo(() => selectHomeAutoConnectHostIds(hosts), [hosts])
  const allClients = useAllHostClients(hostIds, {
    autoConnectHostIds,
    closeUnusedOnRelease: true
  })
  const hostPaths = useMemo(
    () => Object.fromEntries(allClients.map(({ hostId, path }) => [hostId, path])),
    [allClients]
  )
  const hostPendingPaths = useMemo(
    () => Object.fromEntries(allClients.map(({ hostId, pendingPath }) => [hostId, pendingPath])),
    [allClients]
  )
  const hostPairingRejected = useMemo(
    () =>
      Object.fromEntries(
        allClients.map(({ hostId, pairingRejected }) => [hostId, pairingRejected])
      ),
    [allClients]
  )
  const disconnectHostClient = useDisconnectHostClient()
  const forgetHostClient = useForgetHostClient()
  const forceReconnectHost = useForceReconnect()
  const primeHosts = usePrimeHosts()
  // Why: prime the cache with loaded HostProfiles to avoid a second serialized Keychain pass (multi-second connect latency) on cold start.
  useEffect(() => {
    if (hosts.length > 0) {
      primeHosts(hosts)
    }
  }, [hosts, primeHosts])
  const allClientsRef = useRef<Array<{ hostId: string; client: RpcClient }>>([])
  // Why: keep the focus callback stable (no refetch per render) while still exposing the latest host clients.
  allClientsRef.current = allClients.map((entry) => ({
    hostId: entry.hostId,
    client: entry.client
  }))

  // Why: hydrate from a persisted snapshot on cold-start so Resume + Account cards paint immediately instead of flashing empty.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current) {
      return
    }
    hydratedRef.current = true
    let cancelled = false
    void loadHomeSnapshot().then((snap) => {
      if (cancelled || !snap) {
        return
      }
      setWorktreeInfo((prev) => (Object.keys(prev).length > 0 ? prev : snap.worktreeInfo))
      setAccountsByHost((prev) => (Object.keys(prev).length > 0 ? prev : snap.accountsByHost))
      for (const [hostId, info] of Object.entries(snap.worktreeInfo)) {
        const wt = info.lastActiveWorktree
        if (wt) {
          // Why: seed the in-memory cache so resumeWorktree's lastVisited fast-path finds the worktree object.
          setCachedWorktrees(hostId, [wt])
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Why: persist the merged snapshot on each update so the next cold-start has fresh seed data (cache debounces writes).
  useEffect(() => {
    if (Object.keys(worktreeInfo).length === 0 && Object.keys(accountsByHost).length === 0) {
      return
    }
    saveHomeSnapshot({
      worktreeInfo,
      accountsByHost,
      savedAt: Date.now()
    })
  }, [worktreeInfo, accountsByHost])

  useFocusEffect(
    useCallback(() => {
      let stale = false
      void loadHostCatalog().then(async (catalog) => {
        if (stale) {
          return
        }
        setHostCatalog(catalog)
        if (!homeModeHydratedRef.current) {
          const initialMode = await loadInitialMobileHomeMode(AsyncStorage, catalog.length > 0)
          // A user can tap the mode switch while AsyncStorage is resolving.
          // The explicit choice wins over a late hydration result.
          if (!stale && !homeModeHydratedRef.current) {
            homeModeHydratedRef.current = true
            setHomeMode(initialMode)
          }
        }
        if (catalog.length === 0 || onboardingOptInCheckedRef.current) {
          return
        }
        onboardingOptInCheckedRef.current = true
        const onboardingSteps = await loadMobileOnboardingSteps()
        if (stale) {
          return
        }
        if (onboardingSteps.length > 0) {
          router.replace(mobileOnboardingDestination(onboardingSteps))
        }
      })
      void AsyncStorage.getItem(LAST_VISITED_WORKTREE_STORAGE_KEY).then((raw) => {
        if (stale) {
          return
        }
        // Why the validating reader: this record becomes the Resume card's navigation target,
        // so a malformed or older-shaped payload must read as no history, not a broken route.
        setLastVisited(readLastVisitedWorktreeRecord(raw))
      })
      for (const entry of allClientsRef.current) {
        if (entry.client.getState() === 'connected') {
          fetchStats(entry.client, entry.hostId, setStatsByHost, () => stale)
          void fetchHomeHostWorktreeInfo(entry.client, entry.hostId, setWorktreeInfo, () => stale)
          fetchAccountsSnapshot(entry.client, entry.hostId, setAccountsByHost, () => stale)
          fetchTaskProviders(entry.client, entry.hostId, setTaskProvidersByHost, () => stale)
        }
      }
      return () => {
        stale = true
      }
    }, [router])
  )

  const sortedHosts = useMemo(
    () => [...hosts].sort((a, b) => b.lastConnected - a.lastConnected),
    [hosts]
  )
  const sortedHostCatalog = useMemo(
    () => [...hostCatalog].sort((a, b) => b.lastConnected - a.lastConnected),
    [hostCatalog]
  )

  // Why: mirror per-host connection state into hostStates so existing render code (status dots) keeps working.
  useEffect(() => {
    setHostAttempts((prev) => {
      const next: Record<string, number> = { ...prev }
      let changed = false
      for (const entry of allClients) {
        const a = entry.client.getReconnectAttempt()
        if (next[entry.hostId] !== a) {
          next[entry.hostId] = a
          changed = true
        }
      }
      return changed ? next : prev
    })
    setHostLastConnected((prev) => {
      const next: Record<string, number | null> = { ...prev }
      let changed = false
      for (const entry of allClients) {
        const t = entry.client.getLastConnectedAt()
        if (next[entry.hostId] !== t) {
          next[entry.hostId] = t
          changed = true
        }
      }
      return changed ? next : prev
    })
    setHostStates((prev) => {
      const next: Record<string, ConnectionState> = { ...prev }
      let changed = false
      const liveIds = new Set(allClients.map((e) => e.hostId))
      for (const entry of allClients) {
        if (next[entry.hostId] !== entry.state) {
          next[entry.hostId] = entry.state
          changed = true
        }
      }
      // Why: reflect hosts that dropped from allClients, but only if already tracked — else the initial-acquire frame flips all to 'disconnected'.
      for (const host of hostCatalog) {
        if (liveIds.has(host.id)) {
          continue
        }
        if (host.credentialStatus === 'missing') {
          if (next[host.id] !== 'auth-failed') {
            next[host.id] = 'auth-failed'
            changed = true
          }
          continue
        }
        if (host.credentialStatus === 'temporarily-unavailable') {
          if (next[host.id] !== 'disconnected') {
            next[host.id] = 'disconnected'
            changed = true
          }
          continue
        }
        const prevState = next[host.id]
        if (prevState && prevState !== 'disconnected' && prevState !== 'auth-failed') {
          next[host.id] = 'disconnected'
          changed = true
        }
      }
      // Drop entries for hosts we no longer track at all.
      for (const id of Object.keys(next)) {
        if (!liveIds.has(id) && hostCatalog.some((h) => h.id === id) === false) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [allClients, hostCatalog])

  // Notif/accounts subs + a snapshot read per connect for one host. Lives outside the effect body
  // because react-doctor's effect-needs-cleanup false-positives on `subscribe` inside one; the
  // returned disposer owns every handle allocated here.
  const wireHostSubscriptions = (entry: {
    hostId: string
    client: RpcClient
    state: ConnectionState
  }) => {
    let unsubNotif: (() => void) | null = null
    let unsubAccounts: (() => void) | null = null
    const refetchGate = createHostConnectRefetchGate()
    const wireUp = (state: ConnectionState) => {
      const reconnected = refetchGate.observe(state)
      if (state === 'connected') {
        if (!unsubNotif) {
          unsubNotif = subscribeToDesktopNotifications(entry.client, entry.hostId)
        }
        if (!unsubAccounts) {
          unsubAccounts = entry.client.subscribe('accounts.subscribe', null, (payload) => {
            if (!payload || typeof payload !== 'object') {
              return
            }
            const evt = payload as { type?: string; snapshot?: unknown }
            if (evt.type === 'ready' || evt.type === 'snapshot') {
              try {
                const snapshot = decodeAccountsSnapshot(evt.snapshot)
                setAccountsByHost((prev) => ({ ...prev, [entry.hostId]: snapshot }))
              } catch {
                // Keep the last proven snapshot; malformed remote data must
                // not enter render state or crash the home host cards.
              }
            }
          })
        }
        // Why: the socket survives backgrounding/handoffs by reconnecting, so re-read the host
        // snapshot on every reconnect — a one-shot latch left the card on stale data forever.
        if (reconnected) {
          fetchStats(entry.client, entry.hostId, setStatsByHost, () => false)
          void fetchHomeHostWorktreeInfo(entry.client, entry.hostId, setWorktreeInfo, () => false)
          fetchTaskProviders(entry.client, entry.hostId, setTaskProvidersByHost, () => false)
        }
      } else {
        if (unsubNotif) {
          unsubNotif()
          unsubNotif = null
        }
        if (unsubAccounts) {
          unsubAccounts()
          unsubAccounts = null
        }
      }
    }
    wireUp(entry.state)
    const unsubState = entry.client.onStateChange(wireUp)
    return () => {
      unsubState()
      unsubNotif?.()
      unsubAccounts?.()
    }
  }

  // Re-runs per (hostId, client) pair; the socket stays open so it's cheap.
  useEffect(() => {
    const cleanups = allClients.map((entry) => wireHostSubscriptions(entry))
    return () => {
      for (const c of cleanups) {
        c()
      }
    }
    // Why: key on host-id set + each client's identity so resubs fire when forceReconnect swaps a host's client, not on every render.
  }, [
    allClients
      .map((e) => `${e.hostId}:${clientKey(e.client)}`)
      .sort()
      .join(',')
  ])

  // Why: the card renders from cached/snapshot data the moment a candidate exists — see
  // selectHomeResumeCard for why its slot must not wait for the host to connect.
  const resumeCard = useMemo(
    () =>
      selectHomeResumeCard({
        hosts: sortedHosts,
        hostStates,
        worktreeInfo,
        lastVisited,
        cachedWorktrees: (hostId) => getCachedWorktrees(hostId) as HomeWorktreeSummary[] | null
      }),
    [sortedHosts, hostStates, worktreeInfo, lastVisited]
  )

  // Why: the card is drawn from a snapshot that can name a workspace the desktop has since
  // deleted. When the host has proven otherwise, open its workspace list rather than a session
  // screen whose every RPC would fail. An unproven catalog is not evidence — that tap goes
  // through and the session screen bounces once the host answers (F7).
  const openResume = useCallback(
    (card: HomeResumeCard) => {
      if (
        isResumeTargetConfirmedMissing(
          card,
          getProvenCachedWorktrees(card.hostId) as HomeWorktreeSummary[] | null
        )
      ) {
        router.push(hostRouteWithNotice(card.hostId, 'worktree-missing'))
        return
      }
      openMobileSession({
        hostId: card.hostId,
        worktreeId: card.worktree.worktreeId,
        name: card.worktree.displayName || card.worktree.repo
      })
    },
    [openMobileSession, router]
  )

  // Why: only show Account usage for connected hosts; stale cached usage would imply live data.
  const accountsHosts = useMemo(() => {
    const items: Array<{ host: HostProfile; snapshot: AccountsSnapshot }> = []
    for (const host of sortedHosts) {
      if (hostStates[host.id] !== 'connected') {
        continue
      }
      const snap = accountsByHost[host.id]
      if (!snap) {
        continue
      }
      // Why: also show hosts whose only usage is the system-default login, else those users see no usage section.
      if (hasRenderableUsage(snap, 'claude') || hasRenderableUsage(snap, 'codex')) {
        items.push({ host, snapshot: snap })
      }
    }
    return items
  }, [sortedHosts, hostStates, accountsByHost])

  const connectedHosts = useMemo(
    () => sortedHosts.filter((host) => hostStates[host.id] === 'connected'),
    [sortedHosts, hostStates]
  )
  const primaryConnectedHost = connectedHosts[0] ?? null
  const effectiveHomeMode: MobileHomeMode = homeMode ?? 'computer'
  // Why: the toolbar mode is the source of truth for the visible home surface.
  // Keeping a second visibility flag let the tab read “连接电脑” while the
  // cloud preview was still rendered after a mode change.
  const showComputerList = effectiveHomeMode === 'computer'
  const primaryTaskProviders = primaryConnectedHost
    ? (taskProvidersByHost[primaryConnectedHost.id] ?? ['github'])
    : []
  const openTasks = useCallback(
    (provider?: TaskProvider) => {
      if (!primaryConnectedHost) {
        return
      }
      openMobileTasks(primaryConnectedHost.id, provider)
    },
    [openMobileTasks, primaryConnectedHost]
  )

  const changeHomeMode = useCallback((mode: MobileHomeMode) => {
    // Mark hydration complete before awaiting persistence so a late read cannot
    // overwrite the user's explicit mode choice during cold start.
    homeModeHydratedRef.current = true
    setHomeMode(mode)
    void persistMobileHomeMode(AsyncStorage, mode).catch(() => {})
  }, [])
  const renderTaskHomeCard = () => (
    <Pressable
      disabled={!primaryConnectedHost}
      style={({ pressed }) => [
        styles.taskHomeCard,
        !primaryConnectedHost && styles.cardDisabled,
        pressed && styles.hostCardPressed
      ]}
      onPress={() => {
        openTasks()
      }}
    >
      <View style={styles.taskHomeIcon}>
        <ListTodo size={18} color={theme.color.text.secondary} />
      </View>
      <View style={styles.taskHomeMain}>
        <Text style={styles.taskHomeTitle}>任务中心</Text>
        <Text style={styles.taskHomeSubtitle} numberOfLines={1}>
          {primaryTaskProviders.length > 0
            ? primaryTaskProviders.map((provider) => TASK_PROVIDER_LABELS[provider]).join(' · ')
            : '未连接任务来源'}
        </Text>
      </View>
      <View style={styles.taskHomeTrailing}>
        <View
          style={styles.taskHomeProviderRow}
          accessibilityLabel={primaryTaskProviders
            .map((provider) => TASK_PROVIDER_LABELS[provider])
            .join(', ')}
        >
          {primaryTaskProviders.map((provider) => (
            <Pressable
              key={provider}
              accessibilityRole="button"
              accessibilityLabel={`Open ${TASK_PROVIDER_LABELS[provider]} tasks`}
              hitSlop={8}
              style={({ pressed }) => [
                styles.taskHomeProviderButton,
                pressed && styles.taskHomeProviderButtonPressed
              ]}
              onPress={(event) => {
                event.stopPropagation()
                openTasks(provider)
              }}
            >
              <TaskProviderLogo provider={provider} size={22} color={theme.color.text.secondary} />
            </Pressable>
          ))}
        </View>
      </View>
      <ChevronRight size={16} color={theme.color.text.tertiary} />
    </Pressable>
  )

  async function handleRemove() {
    if (!confirmRemove) {
      return
    }
    const hostToRemove = confirmRemove
    try {
      await removeHostAndCloseClient(hostToRemove.id, forgetHostClient)
      setConfirmRemove(null)
      setHostCatalog(await loadHostCatalog())
    } catch {
      // Why: ConfirmModal closes on confirm; re-open for retry so the failure isn't silent.
      setConfirmRemove(hostToRemove)
      Alert.alert('Could not remove host', 'Please try again.')
    }
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: theme.color.bg.canvas }]}
    >
      <MobileHomeToolbar
        hasConnectedComputer={connectedHosts.length > 0}
        mode={effectiveHomeMode}
        onChangeMode={changeHomeMode}
        onOpenMenu={() => setDrawerVisible(true)}
        theme={theme}
      />

      {!showComputerList ? (
        <MobileCloudWorkPreview
          bottomInset={insets.bottom}
          onMore={() => setDrawerVisible(true)}
          onNewTask={() => {
            if (primaryConnectedHost) {
              openTasks()
            } else {
              router.push('/pair-scan')
            }
          }}
          onOpenProject={() => {
            if (primaryConnectedHost) {
              router.push(`/h/${primaryConnectedHost.id}`)
            } else {
              router.push('/pair-scan')
            }
          }}
          onOpenWorkspace={() => {
            if (primaryConnectedHost) {
              router.push(hostNewWorktreeRoute(primaryConnectedHost.id))
            } else {
              router.push('/pair-scan')
            }
          }}
          theme={theme}
        />
      ) : hostCatalog.length === 0 ? (
        <MobileComputerEmptyState
          bottomInset={insets.bottom}
          maxWidth={isWideLayout ? contentMaxWidth : undefined}
          onEnterCode={() => router.push('/pair')}
          onScan={() => router.push('/pair-scan')}
          theme={theme}
        />
      ) : (
        /* ─── Populated state ─── */
        <FlatList
          data={sortedHostCatalog}
          keyExtractor={(h) => h.id}
          // Why: reserve insets.bottom so the last row stays reachable above the system nav bar / home indicator.
          contentContainerStyle={[
            styles.list,
            { paddingBottom: theme.spacing.space24 + insets.bottom },
            isWideLayout && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }
          ]}
          ListHeaderComponent={
            <View>
              <View style={styles.hero}>
                <Text style={styles.heroTitle}>连接电脑</Text>
              </View>

              {stats && (
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>
                      {stats.totalAgentsSpawned.toLocaleString()}
                    </Text>
                    <Text style={styles.statLabel}>已启动 Agent</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{formatDuration(stats.totalAgentTimeMs)}</Text>
                    <Text style={styles.statLabel}>Agent 用时</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{stats.totalPRsCreated.toLocaleString()}</Text>
                    <Text style={styles.statLabel}>已创建 PR</Text>
                  </View>
                </View>
              )}

              <Text style={styles.sectionHeading}>已连接电脑</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.cardGap} />}
          renderItem={({ item }) => {
            const state = resolveHomeHostConnectionState(
              item.id,
              hostStates[item.id],
              autoConnectHostIds
            )
            const attempts = hostAttempts[item.id] ?? 0
            const lastConnectedAt = hostLastConnected[item.id] ?? null
            const verdict = classifyConnection({
              state,
              reconnectAttempts: attempts,
              lastConnectedAt,
              endpoint: item.endpoint,
              pendingPath: hostPendingPaths[item.id] ?? null,
              pairingRejected: hostPairingRejected[item.id] ?? false
            })
            return (
              <MobileHostCard
                theme={theme}
                host={item}
                credentialStatus={item.credentialStatus}
                state={state}
                verdict={verdict}
                path={hostPaths[item.id] ?? 'lan'}
                worktreeInfo={worktreeInfo[item.id]}
                onPress={() => {
                  if (item.credentialStatus === 'missing') {
                    router.push('/pair-scan')
                  } else if (item.credentialStatus === 'temporarily-unavailable') {
                    void loadHostCatalog()
                      .then(setHostCatalog)
                      .catch(() => Alert.alert('Could not check pairing', 'Please try again.'))
                  } else {
                    router.push(`/h/${item.id}`)
                  }
                }}
                onLongPress={() => {
                  triggerMediumImpact()
                  if (item.profile) {
                    setActionTarget(item.profile)
                  } else {
                    setConfirmRemove(item)
                  }
                }}
                onOpenActions={() => {
                  if (item.profile) {
                    setActionTarget(item.profile)
                  } else {
                    setConfirmRemove(item)
                  }
                }}
              />
            )
          }}
          ListFooterComponent={
            <View>
              {/* ─── Resume card ─── */}
              {resumeCard ? (
                <>
                  <Text style={[styles.sectionHeading, styles.sectionHeadingTightTop]}>
                    继续工作
                  </Text>
                  <Pressable
                    disabled={!resumeCard.actionable}
                    style={({ pressed }) => [
                      styles.resumeCard,
                      !resumeCard.actionable && styles.cardDisabled,
                      pressed && styles.hostCardPressed
                    ]}
                    onPress={() => openResume(resumeCard)}
                  >
                    <View style={styles.resumeIcon}>
                      <Terminal size={18} color={theme.color.text.secondary} />
                    </View>
                    <View style={styles.resumeMain}>
                      <Text style={styles.resumeTitle} numberOfLines={1}>
                        {resumeCard.worktree.displayName}
                      </Text>
                      <View style={styles.resumeSub}>
                        <View
                          style={[
                            styles.repoDot,
                            { backgroundColor: repoColor(resumeCard.worktree.repo) }
                          ]}
                        />
                        <Text style={styles.resumeSubText} numberOfLines={1}>
                          {resumeCard.worktree.repo}
                          {'  ·  '}
                          {resumeCard.worktree.branch}
                        </Text>
                      </View>
                    </View>
                    <ChevronRight size={16} color={theme.color.text.tertiary} />
                  </Pressable>
                </>
              ) : null}
              <Text style={[styles.sectionHeading, styles.sectionHeadingTightTop]}>任务中心</Text>
              {renderTaskHomeCard()}

              {/* ─── Quick actions ─── */}
              <MobileHomeQuickActions
                theme={theme}
                connectedHosts={connectedHosts}
                onPairDesktop={() => router.push('/pair-scan')}
                onCreateWorkspace={(hostId) => router.push(hostNewWorktreeRoute(hostId))}
              />

              {/* ─── Account usage ─── */}
              {accountsHosts.length > 0 ? (
                <>
                  <Text style={[styles.sectionHeading, { marginTop: theme.spacing.space24 }]}>
                    Agent 用量
                  </Text>
                  {accountsHosts.map(({ host, snapshot }) => {
                    const claudeActiveId = snapshot.claude.activeAccountId
                    const claudeActive =
                      snapshot.claude.accounts.find((a) => a.id === claudeActiveId) ?? null
                    const codexActiveId = snapshot.codex.activeAccountId
                    const codexActive =
                      snapshot.codex.accounts.find((a) => a.id === codexActiveId) ?? null
                    const showHostName = accountsHosts.length > 1
                    return (
                      <Pressable
                        key={host.id}
                        style={({ pressed }) => [
                          styles.accountsCard,
                          pressed && styles.hostCardPressed
                        ]}
                        onPress={() => openMobileAccounts(host.id)}
                      >
                        {showHostName ? (
                          <Text style={styles.accountsHostLabel} numberOfLines={1}>
                            {host.name}
                          </Text>
                        ) : null}
                        {(['claude', 'codex'] as ProviderKey[]).map((provider) => {
                          const active = provider === 'claude' ? claudeActive : codexActive
                          const accounts =
                            provider === 'claude'
                              ? snapshot.claude.accounts
                              : snapshot.codex.accounts
                          const limits = getActiveProviderRateLimits(snapshot, provider)
                          // Why: with no managed accounts, still render the row when the active target has live usage data.
                          if (accounts.length === 0 && !hasActiveProviderUsage(limits)) {
                            return null
                          }
                          const sessionBar = getUsageBarState(limits, 'session')
                          const weeklyBar = getUsageBarState(limits, 'weekly')
                          return (
                            <View key={provider} style={styles.accountsRow}>
                              <View style={styles.accountsIcon}>
                                {provider === 'claude' ? (
                                  <ClaudeIcon size={18} />
                                ) : (
                                  <OpenAIIcon size={18} color={theme.color.text.primary} />
                                )}
                              </View>
                              <View style={styles.accountsInfo}>
                                <Text style={styles.accountsEmail} numberOfLines={1}>
                                  {active?.email ?? 'System default'}
                                </Text>
                                <View style={styles.accountsBars}>
                                  <UsageBar
                                    theme={theme}
                                    label="5h"
                                    usedPercent={sessionBar.usedPercent}
                                    unavailable={sessionBar.unavailable}
                                    loading={sessionBar.loading}
                                  />
                                  <UsageBar
                                    theme={theme}
                                    label="7d"
                                    usedPercent={weeklyBar.usedPercent}
                                    unavailable={weeklyBar.unavailable}
                                    loading={weeklyBar.loading}
                                  />
                                </View>
                              </View>
                            </View>
                          )
                        })}
                      </Pressable>
                    )
                  })}
                </>
              ) : null}
            </View>
          }
        />
      )}

      <MobileHomeDrawer
        canOpenHostActions={primaryConnectedHost != null}
        onAccount={() => {
          setDrawerVisible(false)
          router.push('/login')
        }}
        onClose={() => setDrawerVisible(false)}
        onComputers={() => {
          changeHomeMode('computer')
          setDrawerVisible(false)
        }}
        onFeedback={() => {
          setDrawerVisible(false)
          router.push('/feedback')
        }}
        onHome={() => {
          changeHomeMode('cloud')
          setDrawerVisible(false)
        }}
        onNewWorkspace={() => {
          setDrawerVisible(false)
          if (primaryConnectedHost) {
            router.push(hostNewWorktreeRoute(primaryConnectedHost.id))
          }
        }}
        onRecentWork={() => {
          setDrawerVisible(false)
          if (resumeCard) {
            openResume(resumeCard)
          }
        }}
        onSettings={() => {
          setDrawerVisible(false)
          router.push('/settings')
        }}
        onTasks={() => {
          setDrawerVisible(false)
          openTasks()
        }}
        pairedComputerCount={hostCatalog.length}
        theme={theme}
        visible={drawerVisible}
      />

      {/* ─── Action sheets (shared by both states) ─── */}
      <ActionSheetModal
        visible={actionTarget != null}
        title={actionTarget?.name}
        message={actionTarget ? hostEndpointLabel(actionTarget.endpoint) : undefined}
        actions={getHostListActionSheetActions({
          host: actionTarget,
          state: actionTarget
            ? resolveHomeHostConnectionState(
                actionTarget.id,
                hostStates[actionTarget.id],
                autoConnectHostIds
              )
            : 'disconnected',
          hasEverConnected: actionTarget
            ? (hostLastConnected[actionTarget.id] ?? null) != null
            : false,
          onDismiss: () => setActionTarget(null),
          onReconnect: (hostId) => void forceReconnectHost(hostId),
          onDisconnect: disconnectHostClient,
          onEdit: openMobileHostEdit,
          onRemove: (host) => setConfirmRemove(host)
        })}
        onClose={() => setActionTarget(null)}
      />

      <ConfirmModal
        visible={confirmRemove != null}
        title="移除电脑"
        message={`确定移除“${confirmRemove?.name}”吗？之后仍可重新配对。`}
        confirmLabel="移除"
        destructive
        onConfirm={() => void handleRemove()}
        onCancel={() => setConfirmRemove(null)}
      />
    </SafeAreaView>
  )
}
