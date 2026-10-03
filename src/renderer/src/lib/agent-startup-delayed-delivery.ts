import { useAppStore } from '@/store'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import {
  bindHostAgentStartupLaunch,
  worktreeStillOwnsStartupTab
} from './agent-startup-host-pane-binding'
import { getAgentStartupTabPtyId } from './agent-startup-tab-resolution'
export { getAgentStartupTabPtyId, resolveAgentStartupTabId } from './agent-startup-tab-resolution'
import {
  agentStartupDeliveryKey as deliveryKey,
  clearConsumedAgentStartupDeliveriesForTests,
  isAgentStartupDeliveryConsumed,
  markAgentStartupDeliveryConsumed,
  releaseAgentStartupDeliveryConsumed
} from './agent-startup-delivery-guards'

type AppStoreSnapshot = ReturnType<typeof useAppStore.getState>

type PendingAgentStartupDelivery = {
  worktreeId: string
  tabId: string
  launchToken: string
  startup: AgentStartupPlan
  hostPane?: { tabId: string; leafId: string }
  deliver: (tabId: string, ptyId: string, startup: AgentStartupPlan) => Promise<void>
}

const pendingAgentStartupDeliveries = new Map<string, PendingAgentStartupDelivery>()
const staleStartupRecheckTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>()
const missingStartupTabExpiryTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>()
const observedStartupTabs = new Set<string>()
const MISSING_STARTUP_TAB_GRACE_MS = 30_000
let unsubscribePendingAgentStartupDeliveries: (() => void) | null = null

function getPendingStartupLaunchToken(state: AppStoreSnapshot, tabId: string): string | undefined {
  return state.pendingStartupByTabId?.[tabId]?.launchToken
}

function hasRegisteredStartupLaunch(
  state: AppStoreSnapshot,
  tabId: string,
  launchToken: string
): boolean {
  return Object.values(state.agentLaunchConfigByPaneKey ?? {}).some(
    (entry) => entry.identity.tabId === tabId && entry.identity.launchToken === launchToken
  )
}

function ensurePendingAgentStartupSubscription(): void {
  if (unsubscribePendingAgentStartupDeliveries) {
    return
  }
  const initial = useAppStore.getState()
  // Capture the individual references so the gate stays allocation-free and
  // remains correct even if a subscribe adapter reuses its state object.
  let previousTabs = initial.tabsByWorktree
  let previousPendingStartups = initial.pendingStartupByTabId
  let previousLaunchConfigs = initial.agentLaunchConfigByPaneKey
  let previousPtyIds = initial.ptyIdsByTabId
  let previousLayouts = initial.terminalLayoutsByTabId
  unsubscribePendingAgentStartupDeliveries = useAppStore.subscribe((state) => {
    // Why: a background workspace can stay unmounted indefinitely. Only these
    // five immutable slices can change delivery eligibility; unrelated title,
    // status, focus, and usage ticks must not rescan every launch registration.
    if (
      state.tabsByWorktree === previousTabs &&
      state.pendingStartupByTabId === previousPendingStartups &&
      state.agentLaunchConfigByPaneKey === previousLaunchConfigs &&
      state.ptyIdsByTabId === previousPtyIds &&
      state.terminalLayoutsByTabId === previousLayouts
    ) {
      return
    }
    // Update before flushing because delivery can synchronously write the store.
    previousTabs = state.tabsByWorktree
    previousPendingStartups = state.pendingStartupByTabId
    previousLaunchConfigs = state.agentLaunchConfigByPaneKey
    previousPtyIds = state.ptyIdsByTabId
    previousLayouts = state.terminalLayoutsByTabId
    flushPendingAgentStartupDeliveries()
  })
}

function stopPendingAgentStartupSubscriptionIfIdle(): void {
  if (pendingAgentStartupDeliveries.size > 0 || !unsubscribePendingAgentStartupDeliveries) {
    return
  }
  unsubscribePendingAgentStartupDeliveries()
  unsubscribePendingAgentStartupDeliveries = null
}

export function queuePendingAgentStartupDelivery(delivery: PendingAgentStartupDelivery): void {
  const key = deliveryKey(delivery)
  if (isAgentStartupDeliveryConsumed(key)) {
    return
  }
  pendingAgentStartupDeliveries.set(key, delivery)
  ensurePendingAgentStartupSubscription()
  flushPendingAgentStartupDeliveries()
}

export function resetAgentStartupDelayedDeliveryForTests(): void {
  pendingAgentStartupDeliveries.clear()
  clearConsumedAgentStartupDeliveriesForTests()
  for (const timer of staleStartupRecheckTimers.values()) {
    globalThis.clearTimeout(timer)
  }
  staleStartupRecheckTimers.clear()
  for (const timer of missingStartupTabExpiryTimers.values()) {
    globalThis.clearTimeout(timer)
  }
  missingStartupTabExpiryTimers.clear()
  observedStartupTabs.clear()
  unsubscribePendingAgentStartupDeliveries?.()
  unsubscribePendingAgentStartupDeliveries = null
}

export function beginAgentStartupDeliveryAttempt(args: {
  worktreeId: string
  tabId: string
  launchToken: string
}): boolean {
  const key = deliveryKey(args)
  if (isAgentStartupDeliveryConsumed(key)) {
    return false
  }
  markAgentStartupDeliveryConsumed(key)
  pendingAgentStartupDeliveries.delete(key)
  clearStaleStartupRecheck(key)
  clearMissingStartupTabExpiry(key)
  observedStartupTabs.delete(key)
  return true
}

export function releaseAgentStartupDeliveryAttempt(args: {
  worktreeId: string
  tabId: string
  launchToken: string
}): void {
  releaseAgentStartupDeliveryConsumed(deliveryKey(args))
}

function flushPendingAgentStartupDeliveries(): void {
  const state = useAppStore.getState()
  for (const [key, delivery] of pendingAgentStartupDeliveries) {
    const { tabId, launchToken } = delivery
    if (!worktreeStillOwnsStartupTab(state, delivery.worktreeId, tabId)) {
      if (observedStartupTabs.has(key)) {
        pendingAgentStartupDeliveries.delete(key)
        clearStaleStartupRecheck(key)
        clearMissingStartupTabExpiry(key)
        observedStartupTabs.delete(key)
      } else {
        scheduleMissingStartupTabExpiry(key)
      }
      continue
    }
    observedStartupTabs.add(key)
    clearMissingStartupTabExpiry(key)
    const binding = bindHostAgentStartupLaunch({
      worktreeId: delivery.worktreeId,
      tabId,
      launchToken,
      startup: delivery.startup,
      hostPane: delivery.hostPane
    })
    if (binding === 'conflict') {
      pendingAgentStartupDeliveries.delete(key)
      clearStaleStartupRecheck(key)
      observedStartupTabs.delete(key)
      continue
    }
    const deliveryState = binding === 'bound' ? useAppStore.getState() : state
    const queuedLaunchToken = getPendingStartupLaunchToken(deliveryState, tabId)
    const launchRegistered = hasRegisteredStartupLaunch(deliveryState, tabId, launchToken)
    if (queuedLaunchToken !== launchToken && !launchRegistered && queuedLaunchToken !== undefined) {
      pendingAgentStartupDeliveries.delete(key)
      clearStaleStartupRecheck(key)
      observedStartupTabs.delete(key)
      continue
    }
    if (queuedLaunchToken === undefined && !launchRegistered) {
      scheduleStaleStartupRecheck(key)
      continue
    }
    const ptyId = getAgentStartupTabPtyId(deliveryState, tabId, launchToken)
    if (!ptyId) {
      continue
    }
    // Why: once the launch-bound PTY exists, the bounded readiness/paste path
    // owns success or failure. Consume before awaiting so store churn cannot
    // duplicate a linked-work-item draft.
    if (beginAgentStartupDeliveryAttempt(delivery)) {
      void delivery.deliver(tabId, ptyId, delivery.startup).catch((error) => {
        console.warn('Queued agent startup delivery failed', error)
      })
    }
  }
  stopPendingAgentStartupSubscriptionIfIdle()
}

function scheduleMissingStartupTabExpiry(key: string): void {
  if (missingStartupTabExpiryTimers.has(key)) {
    return
  }
  missingStartupTabExpiryTimers.set(
    key,
    globalThis.setTimeout(() => {
      missingStartupTabExpiryTimers.delete(key)
      const delivery = pendingAgentStartupDeliveries.get(key)
      if (!delivery) {
        stopPendingAgentStartupSubscriptionIfIdle()
        return
      }
      if (
        worktreeStillOwnsStartupTab(useAppStore.getState(), delivery.worktreeId, delivery.tabId)
      ) {
        flushPendingAgentStartupDeliveries()
      } else {
        pendingAgentStartupDeliveries.delete(key)
        clearStaleStartupRecheck(key)
        observedStartupTabs.delete(key)
        stopPendingAgentStartupSubscriptionIfIdle()
      }
    }, MISSING_STARTUP_TAB_GRACE_MS)
  )
}

function clearMissingStartupTabExpiry(key: string): void {
  const timer = missingStartupTabExpiryTimers.get(key)
  if (!timer) {
    return
  }
  globalThis.clearTimeout(timer)
  missingStartupTabExpiryTimers.delete(key)
}

function scheduleStaleStartupRecheck(key: string): void {
  if (staleStartupRecheckTimers.has(key)) {
    return
  }
  staleStartupRecheckTimers.set(
    key,
    globalThis.setTimeout(() => {
      staleStartupRecheckTimers.delete(key)
      const delivery = pendingAgentStartupDeliveries.get(key)
      if (!delivery) {
        stopPendingAgentStartupSubscriptionIfIdle()
        return
      }
      const state = useAppStore.getState()
      const queuedLaunchToken = getPendingStartupLaunchToken(state, delivery.tabId)
      if (
        queuedLaunchToken === undefined &&
        !hasRegisteredStartupLaunch(state, delivery.tabId, delivery.launchToken)
      ) {
        pendingAgentStartupDeliveries.delete(key)
        observedStartupTabs.delete(key)
      } else {
        flushPendingAgentStartupDeliveries()
      }
      stopPendingAgentStartupSubscriptionIfIdle()
    }, 1000)
  )
}

function clearStaleStartupRecheck(key: string): void {
  const timer = staleStartupRecheckTimers.get(key)
  if (!timer) {
    return
  }
  globalThis.clearTimeout(timer)
  staleStartupRecheckTimers.delete(key)
}
