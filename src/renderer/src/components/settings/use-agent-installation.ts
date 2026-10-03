import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import type {
  AgentInstallRequest,
  AgentInstallResult
} from '../../../../shared/agent-install-types'
import {
  AGENT_INSTALL_PROVIDERS,
  AGENT_UPGRADE_COMMANDS
} from '../../../../shared/agent-install-providers'
import { normalizeAgentNpmRegistry } from '../../../../shared/agent-npm-registry'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { AgentVersionTarget } from './agent-version-cache'

export type AgentInstallationSnapshot = {
  installing: boolean
  result: AgentInstallResult | null
  action?: 'install' | 'upgrade'
  hostBusy?: boolean
}
const EMPTY: AgentInstallationSnapshot = { installing: false, result: null }
type InstallationObserver = {
  targetKey: string
  available: boolean
  onInstalled: (agent: TuiAgent) => Promise<unknown>
}

// Installation continues after Settings unmounts; every mounted page observes the same host state.
let snapshots: Record<string, AgentInstallationSnapshot> = {}
const pending = new Map<string, { agent: TuiAgent; action: 'install' | 'upgrade' }>()
const refreshed = new Set<string>()
const refreshPending = new Set<string>()
const observers = new Set<RefObject<InstallationObserver>>()
const listeners = new Set<() => void>()
let revision = 0
const getRevision = () => revision
const notify = () => {
  revision++
  for (const listener of listeners) {
    listener()
  }
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function refreshCompletedInstallation(
  key: string,
  agent: TuiAgent,
  observer: InstallationObserver
) {
  const snapshot = snapshots[key]
  if (snapshot?.result?.status !== 'installed' || refreshed.has(key) || refreshPending.has(key)) {
    return
  }
  refreshPending.add(key)
  void Promise.resolve()
    .then(() => observer.onInstalled(agent))
    .then(() => {
      if (snapshots[key] === snapshot) {
        refreshed.add(key)
      }
    })
    .catch(() => {})
    .finally(() => {
      refreshPending.delete(key)
      if (snapshots[key] !== snapshot) {
        notify()
      }
    })
}

export function _resetAgentInstallationStateForTest(): void {
  snapshots = {}
  pending.clear()
  refreshed.clear()
  refreshPending.clear()
  notify()
}

export function useAgentInstallation(
  target: AgentVersionTarget,
  available: boolean,
  onInstalled: (agent: TuiAgent) => Promise<unknown>
) {
  const targetKey = JSON.stringify([target.environmentId, target.platform, target.wslDistro])
  const registry = normalizeAgentNpmRegistry(target.registry)
  const observerRef = useRef({ targetKey, available, onInstalled })
  observerRef.current = { targetKey, available, onInstalled }
  const observedRevision = useSyncExternalStore(subscribe, getRevision, getRevision)
  useEffect(() => {
    observers.add(observerRef)
    return () => {
      observers.delete(observerRef)
    }
  }, [])

  useEffect(() => {
    if (!available) {
      return
    }
    const supported = new Set<TuiAgent>([
      ...(Object.keys(AGENT_INSTALL_PROVIDERS) as TuiAgent[]),
      ...(Object.keys(AGENT_UPGRADE_COMMANDS) as TuiAgent[])
    ])
    for (const agent of supported) {
      for (const source of ['default', 'china']) {
        const key = `${targetKey}:${source}:${agent}`
        refreshCompletedInstallation(key, agent, observerRef.current)
      }
    }
  }, [targetKey, available, observedRevision])

  return {
    getSnapshot: (agent: TuiAgent): AgentInstallationSnapshot => {
      const running = pending.get(targetKey)
      const snapshot =
        running?.agent === agent
          ? { installing: true, result: null, action: running.action }
          : (snapshots[`${targetKey}:${registry}:${agent}`] ?? EMPTY)
      return { ...snapshot, hostBusy: Boolean(running) }
    },
    install: async (
      agent: TuiAgent,
      action: 'install' | 'upgrade' = 'install',
      commandOverride?: string,
      expectedRealPath?: string
    ): Promise<void> => {
      const key = `${targetKey}:${registry}:${agent}`
      const provider = AGENT_INSTALL_PROVIDERS[agent]
      const supported =
        action === 'install'
          ? Boolean(provider)
          : provider?.kind === 'npm' ||
            provider?.kind === 'bun' ||
            provider?.kind === 'uv' ||
            provider?.kind === 'binary' ||
            Boolean(AGENT_UPGRADE_COMMANDS[agent])
      if (!available || !supported || pending.has(targetKey)) {
        return
      }
      pending.set(targetKey, { agent, action })
      refreshed.delete(key)
      snapshots[key] = { installing: true, result: null, action }
      notify()
      let result: AgentInstallResult
      try {
        const request: AgentInstallRequest = {
          agent,
          wslDistro: target.wslDistro,
          action,
          registry,
          ...(action === 'upgrade' && expectedRealPath ? { expectedRealPath } : {}),
          ...(action === 'upgrade' && commandOverride ? { commandOverride } : {})
        }
        result = target.environmentId
          ? await callRuntimeRpc<AgentInstallResult>(
              { kind: 'environment', environmentId: target.environmentId },
              'preflight.installAgent',
              request,
              { timeoutMs: 300_000 }
            )
          : typeof window.api?.preflight?.installAgent === 'function'
            ? await window.api.preflight.installAgent(request)
            : { status: 'error', version: null, reason: 'bridge-unavailable' }
      } catch (error) {
        result = {
          status: 'error',
          version: null,
          reason: error instanceof Error ? error.message.slice(0, 512) : 'install-failed'
        }
      } finally {
        pending.delete(targetKey)
      }
      snapshots[key] = { installing: false, result, action }
      notify()
      const matchingObservers = [...observers]
        .map((ref) => ref.current)
        .filter((observer) => observer.targetKey === targetKey)
      const currentObserver = matchingObservers.find((observer) => observer.available)
      const closedObserver = observerRef.current
      const refreshObserver =
        currentObserver ??
        (matchingObservers.length === 0 &&
        !observers.has(observerRef) &&
        closedObserver.targetKey === targetKey &&
        closedObserver.available
          ? closedObserver
          : undefined)
      if (refreshObserver) {
        refreshCompletedInstallation(key, agent, refreshObserver)
      }
    }
  }
}
