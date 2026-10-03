import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type {
  AgentVersionResult,
  LatestAgentVersionResult
} from '../../../../shared/agent-version-types'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { normalizeAgentNpmRegistry } from '../../../../shared/agent-npm-registry'
import {
  createAgentVersionCache,
  type AgentVersionQuery,
  type AgentVersionTarget
} from './agent-version-cache'

const cache = createAgentVersionCache({
  current: (query) => {
    const params = {
      agent: query.agent,
      commandOverride: query.commandOverride,
      wslDistro: query.target.wslDistro
    }
    if (
      !query.target.environmentId &&
      typeof window.api?.preflight?.readAgentVersion !== 'function'
    ) {
      return Promise.resolve({ status: 'error', version: null, reason: 'bridge-unavailable' })
    }
    return query.target.environmentId
      ? callRuntimeRpc<AgentVersionResult>(
          { kind: 'environment', environmentId: query.target.environmentId },
          'preflight.readAgentVersion',
          params
        )
      : window.api.preflight.readAgentVersion(params)
  },
  latest: (query) => {
    if (
      !query.target.environmentId &&
      typeof window.api?.preflight?.readLatestAgentVersion !== 'function'
    ) {
      return Promise.resolve({
        status: 'error',
        version: null,
        channel: 'npm-latest',
        reason: 'bridge-unavailable'
      })
    }
    return query.target.environmentId
      ? callRuntimeRpc<LatestAgentVersionResult>(
          { kind: 'environment', environmentId: query.target.environmentId },
          'preflight.readLatestAgentVersion',
          { agent: query.agent, registry: normalizeAgentNpmRegistry(query.target.registry) }
        )
      : window.api.preflight.readLatestAgentVersion({
          agent: query.agent,
          registry: normalizeAgentNpmRegistry(query.target.registry)
        })
  }
})

export function useAgentVersions(
  target: AgentVersionTarget,
  detected: TuiAgent[],
  overrides: Partial<Record<TuiAgent, string>>,
  available = true
) {
  const registry = normalizeAgentNpmRegistry(target.registry)
  const previousRegistry = useRef(registry)
  const queries = useMemo(
    () =>
      detected.map((agent): AgentVersionQuery => ({
        target,
        agent,
        commandOverride: overrides[agent]
      })),
    [target, detected, overrides]
  )
  useSyncExternalStore(cache.subscribe, cache.getRevision, cache.getRevision)
  useEffect(() => {
    if (!available) {
      return
    }
    const registryChanged = previousRegistry.current !== registry
    previousRegistry.current = registry
    const releaseQueries = queries.map((query) => cache.retain(query))
    for (const query of queries) {
      void (registryChanged ? cache.refresh(query) : cache.ensure(query))
    }
    return () => {
      for (const release of releaseQueries) {
        release()
      }
    }
  }, [queries, available, registry])
  return {
    snapshots: Object.fromEntries(
      queries.map((query) => {
        const snapshot = cache.get(query)
        return [
          query.agent,
          !available && !snapshot.current
            ? {
                current: { status: 'unsupported' as const, version: null },
                latest: {
                  status: 'unsupported' as const,
                  version: null,
                  channel: 'npm-latest' as const
                },
                currentLoading: false,
                latestLoading: false
              }
            : snapshot
        ]
      })
    ),
    checkLatest: () =>
      available
        ? Promise.all(queries.map((query) => cache.checkLatest(query)))
        : Promise.resolve([]),
    retry: (agent: TuiAgent) => {
      if (!available) {
        return
      }
      const query = queries.find((item) => item.agent === agent)
      if (query) {
        void cache.refresh(query)
      }
    },
    refresh: (agent: TuiAgent) =>
      available
        ? cache.refresh({ target, agent, commandOverride: overrides[agent] })
        : Promise.resolve([])
  }
}
