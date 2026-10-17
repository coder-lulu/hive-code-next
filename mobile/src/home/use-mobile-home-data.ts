import { subscribeLocalRuntimeConnectionsChanged } from '../runtime-directory/local-runtime-connections-changed'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AccountsSnapshot } from '../components/AccountUsage'
import { hasRenderableUsage } from '../components/AccountUsage'
import { loadHomeSnapshot, saveHomeSnapshot } from '../cache/home-snapshot-cache'
import { getCachedWorktrees, setCachedWorktrees } from '../cache/worktree-cache'
import {
  loadMobileOnboardingSteps,
  mobileOnboardingDestination
} from '../onboarding/mobile-onboarding-plan'
import { totalHomeStats, type HomeStatsRow } from '../stats/home-stats-total'
import { useAccountVisibleHostCatalog } from '../runtime-directory/use-account-visible-host-catalog'
import type { TaskProvider } from '../../../src/shared/task-providers'
import {
  selectConnectableHostProfiles,
  sortHostsByLastConnected
} from '../transport/host-catalog-selection'
import type { HostProfile } from '../transport/types'
import { fetchHomeHostWorktreeInfo } from '../worktree/home-host-worktree-fetch'
import type { HomeWorktreeSummary, HostWorktreeInfo } from '../worktree/home-worktree-info'
import {
  LAST_VISITED_WORKTREE_STORAGE_KEY,
  readLastVisitedWorktreeRecord
} from '../worktree/last-visited-worktree-repo'
import { selectHomeResumeCard } from '../worktree/home-resume-card'
import {
  fetchMobileHomeAccounts,
  fetchMobileHomeStats,
  fetchMobileHomeTaskProviders
} from './mobile-home-host-requests'
import { projectHomeHostConnections } from './home-host-connection-projection'
import { useMobileHomeHostConnections } from './use-mobile-home-host-connections'

export function useMobileHomeData() {
  const router = useRouter()
  const {
    catalog: hostCatalog,
    reload: reloadHostCatalog,
    loaded: hostCatalogLoaded,
    error: hostCatalogError
  } = useAccountVisibleHostCatalog()
  const [statsByHost, setStatsByHost] = useState<Record<string, HomeStatsRow>>({})
  const [worktreeInfo, setWorktreeInfo] = useState<Record<string, HostWorktreeInfo>>({})
  const [accountsByHost, setAccountsByHost] = useState<Record<string, AccountsSnapshot>>({})
  const [taskProvidersByHost, setTaskProvidersByHost] = useState<Record<string, TaskProvider[]>>({})
  const [lastVisited, setLastVisited] = useState<{ hostId: string; worktreeId: string } | null>(
    null
  )
  const removedHostIdsRef = useRef(new Set<string>())
  const absentHostIdsRef = useRef(new Set<string>())
  useEffect(
    () =>
      subscribeLocalRuntimeConnectionsChanged((hostIds) => {
        for (const id of hostIds) {
          removedHostIdsRef.current.add(id)
        }
        const prune = <T>(previous: Record<string, T>): Record<string, T> =>
          Object.fromEntries(Object.entries(previous).filter(([id]) => !hostIds.includes(id)))
        setStatsByHost(prune)
        setWorktreeInfo(prune)
        setAccountsByHost(prune)
        setTaskProvidersByHost(prune)
        setLastVisited((previous) =>
          previous && hostIds.includes(previous.hostId) ? null : previous
        )
      }),
    []
  )
  useEffect(() => {
    const present = new Set(hostCatalog.map((entry) => entry.id))
    for (const id of removedHostIdsRef.current) {
      if (!present.has(id)) {
        absentHostIdsRef.current.add(id)
      } else if (absentHostIdsRef.current.has(id)) {
        removedHostIdsRef.current.delete(id)
        absentHostIdsRef.current.delete(id)
      }
    }
  }, [hostCatalog])
  const onboardingCheckedRef = useRef(false)
  const hydratedRef = useRef(false)
  const hosts = useMemo(() => selectConnectableHostProfiles(hostCatalog), [hostCatalog])
  const connections = useMobileHomeHostConnections(hosts, hostCatalog, {
    setStats: setStatsByHost,
    setWorktreeInfo,
    setAccounts: setAccountsByHost,
    setTaskProviders: setTaskProvidersByHost
  })
  const allClientsRef = useRef(connections.allClients)
  useEffect(() => {
    if (hydratedRef.current) {
      return
    }
    hydratedRef.current = true
    let cancelled = false
    void loadHomeSnapshot().then((snapshot) => {
      if (cancelled || !snapshot) {
        return
      }
      const retained = <T>(values: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
          Object.entries(values).filter(([id]) => !removedHostIdsRef.current.has(id))
        )
      setWorktreeInfo((previous) =>
        Object.keys(previous).length > 0 ? previous : retained(snapshot.worktreeInfo)
      )
      setAccountsByHost((previous) =>
        Object.keys(previous).length > 0 ? previous : retained(snapshot.accountsByHost)
      )
      for (const [hostId, info] of Object.entries(snapshot.worktreeInfo)) {
        if (info.lastActiveWorktree && !removedHostIdsRef.current.has(hostId)) {
          setCachedWorktrees(hostId, [info.lastActiveWorktree])
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (Object.keys(worktreeInfo).length === 0 && Object.keys(accountsByHost).length === 0) {
      return
    }
    const ids = removedHostIdsRef.current
    saveHomeSnapshot({
      worktreeInfo: Object.fromEntries(Object.entries(worktreeInfo).filter(([id]) => !ids.has(id))),
      accountsByHost: Object.fromEntries(
        Object.entries(accountsByHost).filter(([id]) => !ids.has(id))
      ),
      savedAt: Date.now()
    })
  }, [worktreeInfo, accountsByHost])

  useEffect(() => {
    allClientsRef.current = connections.allClients
  }, [connections.allClients])

  useFocusEffect(
    useCallback(() => {
      let stale = false
      void reloadHostCatalog()
        .then(async (catalog) => {
          if (stale) {
            return
          }
          if (catalog.length === 0 || onboardingCheckedRef.current) {
            return
          }
          onboardingCheckedRef.current = true
          const steps = await loadMobileOnboardingSteps()
          if (!stale && steps.length > 0) {
            router.replace(mobileOnboardingDestination(steps))
          }
        })
        .catch(() => undefined)
      void AsyncStorage.getItem(LAST_VISITED_WORKTREE_STORAGE_KEY).then((raw) => {
        if (!stale) {
          const record = readLastVisitedWorktreeRecord(raw)
          setLastVisited(record && removedHostIdsRef.current.has(record.hostId) ? null : record)
        }
      })
      for (const entry of allClientsRef.current) {
        if (entry.client.getState() === 'connected') {
          fetchMobileHomeStats(entry.client, entry.hostId, setStatsByHost, () => stale)
          void fetchHomeHostWorktreeInfo(entry.client, entry.hostId, setWorktreeInfo, () => stale)
          fetchMobileHomeAccounts(entry.client, entry.hostId, setAccountsByHost, () => stale)
          fetchMobileHomeTaskProviders(
            entry.client,
            entry.hostId,
            setTaskProvidersByHost,
            () => stale
          )
        }
      }
      return () => {
        stale = true
      }
    }, [reloadHostCatalog, router])
  )

  const sortedHosts = useMemo(() => sortHostsByLastConnected(hosts), [hosts])
  const sortedHostCatalog = useMemo(() => sortHostsByLastConnected(hostCatalog), [hostCatalog])
  const hostIds = useMemo(() => hosts.map((host) => host.id), [hosts])
  const stats = useMemo(() => totalHomeStats(statsByHost, hostIds), [statsByHost, hostIds])
  const resumeCard = useMemo(
    () =>
      selectHomeResumeCard({
        hosts: sortedHosts,
        hostStates: connections.hostStates,
        worktreeInfo,
        lastVisited,
        cachedWorktrees: (hostId) => getCachedWorktrees(hostId) as HomeWorktreeSummary[] | null
      }),
    [sortedHosts, connections.hostStates, worktreeInfo, lastVisited]
  )
  const accountsHosts = useMemo(() => {
    const items: { host: HostProfile; snapshot: AccountsSnapshot }[] = []
    for (const host of sortedHosts) {
      const snapshot = accountsByHost[host.id]
      if (
        connections.hostStates[host.id] === 'connected' &&
        snapshot &&
        (hasRenderableUsage(snapshot, 'claude') || hasRenderableUsage(snapshot, 'codex'))
      ) {
        items.push({ host, snapshot })
      }
    }
    return items
  }, [sortedHosts, connections.hostStates, accountsByHost])
  const connectedHosts = useMemo(
    () => sortedHosts.filter((host) => connections.hostStates[host.id] === 'connected'),
    [sortedHosts, connections.hostStates]
  )
  const primaryHost = connectedHosts[0] ?? null
  const primaryTaskProviders = primaryHost
    ? (taskProvidersByHost[primaryHost.id] ?? ['github'])
    : []
  const hostConnections = useMemo(
    () => projectHomeHostConnections(connections.allClients),
    [connections.allClients]
  )
  const legacyHostConnections = useMemo(() => {
    const hostPaths: Record<string, (typeof hostConnections)[string]['path']> = {}
    const hostPendingPaths: Record<string, (typeof hostConnections)[string]['pendingPath']> = {}
    const hostPairingRejected: Record<string, boolean> = {}
    const hostSignedOut: Record<string, boolean> = {}
    for (const [hostId, connection] of Object.entries(hostConnections)) {
      hostPaths[hostId] = connection.path
      hostPendingPaths[hostId] = connection.pendingPath
      hostPairingRejected[hostId] = connection.pairingRejected
      hostSignedOut[hostId] = connection.relayHostReachability === 'signed-out'
    }
    return { hostPairingRejected, hostPaths, hostPendingPaths, hostSignedOut }
  }, [hostConnections])

  return {
    ...connections,
    accountsHosts,
    lastVisited,
    connectedHosts,
    hostCatalog,
    hostCatalogLoaded,
    hostCatalogError,
    hostConnections,
    ...legacyHostConnections,
    primaryHost,
    primaryTaskProviders,
    resumeCard,
    reloadHostCatalog,
    router,
    sortedHostCatalog,
    stats,
    taskProvidersByHost,
    worktreeInfo
  }
}
