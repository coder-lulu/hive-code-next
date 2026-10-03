import { hasInstalledAgentSkillNamed } from './installed-agent-skill-matching'
export {
  hasInstalledAgentSkill,
  hasInstalledAgentSkillNamed,
  hasUnreadableAgentSkillSource
} from './installed-agent-skill-matching'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  DiscoveredSkill,
  SkillDiscoveryResult,
  SkillDiscoverySource,
  SkillDiscoveryTarget,
  SkillSourceKind
} from '../../../shared/skills'
import { ORCHESTRATION_SKILL_NAME } from '@/lib/agent-feature-install-commands'
import { markOrchestrationSetupComplete } from '@/lib/orchestration-setup-state'
import {
  discoverInstalledAgentSkills,
  getCachedSkillDiscovery,
  getRuntimeScopedSkillDiscoveryKey,
  getSkillDiscoveryTargetKey,
  resetSkillDiscoveryCacheForTests
} from './installed-agent-skill-discovery'
import { subscribeInstalledAgentSkillDiscoveryCache } from './installed-agent-skill-discovery-cache'
import {
  getInstalledAgentSkillVerdict,
  type InstalledAgentSkillScan
} from './installed-agent-skill-verdict'
import {
  INSTALLED_AGENT_SKILLS_CHANGED_EVENT,
  INSTALLED_AGENT_SKILLS_REFRESHED_EVENT
} from './installed-agent-skills-change-event'
import { useActiveSkillDiscoveryRuntimeTarget } from './use-active-skill-discovery-runtime-target'
import { useMountedRef } from './useMountedRef'

/** Placeholder key while the owning runtime is unknown; nothing is cached under it. */
const UNRESOLVED_RUNTIME_DISCOVERY_KEY = 'runtime:unresolved'

export { notifyInstalledAgentSkillsChanged } from './installed-agent-skill-discovery'

export const GLOBAL_AGENT_SKILL_SOURCE_KINDS = [
  'home'
] as const satisfies readonly SkillSourceKind[]

type InstalledAgentSkillOptions = {
  enabled?: boolean
  readCachedWhenDisabled?: boolean
  discoveryTarget?: SkillDiscoveryTarget
  sourceKinds?: readonly SkillSourceKind[]
}

export type InstalledAgentSkillState = {
  installed: boolean
  loading: boolean
  // Why: a forced rescan keeps the previous result, so only the first scan per
  // runtime-scoped target is genuinely unknown.
  settled: boolean
  // A negative this scan cannot vouch for: render it as unknown, not as undone.
  installedUnverifiable: boolean
  error: string | null
  skills: readonly DiscoveredSkill[]
  sources: readonly SkillDiscoverySource[]
  refresh: () => Promise<boolean>
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase()
}

const isOrchestrationSkillName = (skillName: string): boolean =>
  normalizeSkillName(skillName) === ORCHESTRATION_SKILL_NAME

export function notifyInstalledAgentSkillsRefreshed(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INSTALLED_AGENT_SKILLS_REFRESHED_EVENT))
  }
}

export const _installedAgentSkillDiscoveryInternalsForTests = {
  discoverInstalledAgentSkills,
  getSkillDiscoveryTargetKey,
  isOrchestrationSkillName,
  reset: resetSkillDiscoveryCacheForTests
}

export function useInstalledAgentSkill(
  skillName: string,
  options: InstalledAgentSkillOptions = {}
): InstalledAgentSkillState {
  return useInstalledAgentSkillNames([skillName], options)
}

export function useInstalledAgentSkillNames(
  skillNames: readonly string[],
  options: InstalledAgentSkillOptions = {}
): InstalledAgentSkillState {
  const { enabled = true, readCachedWhenDisabled = false, discoveryTarget, sourceKinds } = options
  const skillNamesKey = skillNames.map(normalizeSkillName).join('\n')
  const candidateSkillNames = useMemo(() => skillNamesKey.split('\n'), [skillNamesKey])
  const runtimeTarget = useActiveSkillDiscoveryRuntimeTarget()
  const discoveryTargetKey = runtimeTarget
    ? getRuntimeScopedSkillDiscoveryKey(
        runtimeTarget,
        discoveryTarget,
        candidateSkillNames,
        sourceKinds
      )
    : UNRESOLVED_RUNTIME_DISCOVERY_KEY
  // Why: callers derive the target inside a store-backed useMemo, so unrelated
  // store writes hand us a new object with the same key. Two targets with the
  // same key resolve to the same scan, so hold one until the key moves and keep
  // `refresh` — and the discovery effect it drives — stable. State, not a ref:
  // React may discard a useMemo, and a render-phase ref write can leak from a
  // render that never commits.
  const [latchedDiscoveryTarget, setLatchedDiscoveryTarget] = useState({
    key: discoveryTargetKey,
    target: discoveryTarget
  })
  if (latchedDiscoveryTarget.key !== discoveryTargetKey) {
    setLatchedDiscoveryTarget({ key: discoveryTargetKey, target: discoveryTarget })
  }
  const stableDiscoveryTarget =
    latchedDiscoveryTarget.key === discoveryTargetKey
      ? latchedDiscoveryTarget.target
      : discoveryTarget
  const subscribeToCachedDiscovery = useCallback(
    (listener: () => void) =>
      subscribeInstalledAgentSkillDiscoveryCache(discoveryTargetKey, listener),
    [discoveryTargetKey]
  )
  const readCachedDiscovery = useCallback(
    () => getCachedSkillDiscovery(discoveryTargetKey),
    [discoveryTargetKey]
  )
  const cachedDiscovery = useSyncExternalStore(
    subscribeToCachedDiscovery,
    readCachedDiscovery,
    readCachedDiscovery
  )
  const [result, setResult] = useState<SkillDiscoveryResult | null>(cachedDiscovery)
  const [loading, setLoading] = useState(enabled && !cachedDiscovery)
  const [error, setError] = useState<string | null>(null)
  const currentDiscoveryTargetKeyRef = useRef(discoveryTargetKey)
  const refreshGenerationRef = useRef(0)
  const failedCacheSnapshotRef = useRef<{
    key: string
    cached: SkillDiscoveryResult | null
  } | null>(null)
  // Why: the runtime target only changes identity when the owning peer does
  // (switch or same-id re-pair), so it resets state alongside the key. State,
  // not a ref: a render-phase ref write survives a render React discards, which
  // would skip the reset and keep painting the retired peer's list.
  const [stateResetInput, setStateResetInput] = useState({
    discoveryTargetKey,
    enabled,
    runtimeTarget
  })
  currentDiscoveryTargetKeyRef.current = discoveryTargetKey
  // Why: skill scans can outlive transient settings/onboarding panels; keep
  // the module cache update but skip React state writes after unmount.
  const mountedRef = useMountedRef()
  let resultForRender = result
  let loadingForRender = loading
  let errorForRender = error
  if (
    stateResetInput.discoveryTargetKey !== discoveryTargetKey ||
    stateResetInput.enabled !== enabled ||
    stateResetInput.runtimeTarget !== runtimeTarget
  ) {
    const nextCachedDiscovery = getCachedSkillDiscovery(discoveryTargetKey)
    const nextLoading = enabled && !nextCachedDiscovery
    setStateResetInput({ discoveryTargetKey, enabled, runtimeTarget })
    resultForRender = nextCachedDiscovery
    loadingForRender = nextLoading
    errorForRender = null
    setResult(nextCachedDiscovery)
    setLoading(nextLoading)
    setError(null)
  }

  const refresh = useCallback(
    async (force = true, showLoading = true): Promise<boolean> => {
      const failedSnapshot = failedCacheSnapshotRef.current
      if (
        !force &&
        failedSnapshot?.cached &&
        failedSnapshot.key === discoveryTargetKey &&
        getCachedSkillDiscovery(discoveryTargetKey) === failedSnapshot.cached
      ) {
        // A cached result predating a failed forced scan cannot clear that failure.
        return false
      }
      const requestGeneration = ++refreshGenerationRef.current
      const writeIfCurrent = (write: () => void): void => {
        if (
          mountedRef.current &&
          requestGeneration === refreshGenerationRef.current &&
          currentDiscoveryTargetKeyRef.current === discoveryTargetKey
        ) {
          write()
        }
      }

      if (!enabled) {
        writeIfCurrent(() => {
          setLoading(false)
        })
        return false
      }
      if (showLoading) {
        writeIfCurrent(() => {
          setLoading(true)
        })
      }
      if (!runtimeTarget) {
        // Why: stay in the loading state rather than scanning the wrong host and
        // reporting "not installed" before the owning runtime is known.
        return false
      }
      let installedAfterRefresh = false
      try {
        const next = await discoverInstalledAgentSkills(
          force,
          stableDiscoveryTarget,
          runtimeTarget,
          candidateSkillNames,
          sourceKinds
        )
        installedAfterRefresh = hasInstalledAgentSkillNamed(next.skills, candidateSkillNames, {
          sourceKinds
        })
        writeIfCurrent(() => {
          failedCacheSnapshotRef.current = null
          setResult(next)
          setError(null)
        })
      } catch (refreshError) {
        writeIfCurrent(() => {
          failedCacheSnapshotRef.current = {
            key: discoveryTargetKey,
            cached: getCachedSkillDiscovery(discoveryTargetKey)
          }
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : 'Could not scan installed skills.'
          )
        })
      } finally {
        // Why: a silent refresh can supersede an in-flight loading one, whose own
        // clear is then dropped by the generation guard. Only the winning
        // generation clears, so it must clear regardless of its own showLoading.
        writeIfCurrent(() => {
          setLoading(false)
        })
      }
      return installedAfterRefresh
    },
    [
      candidateSkillNames,
      discoveryTargetKey,
      enabled,
      mountedRef,
      runtimeTarget,
      sourceKinds,
      stableDiscoveryTarget
    ]
  )

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  useEffect(() => {
    if (!enabled) {
      return
    }
    // Why: skill install commands run outside React state, often in a terminal, so
    // an install event is authoritative and forces past every cache.
    const refreshFromInstall = (): void => {
      void refresh(true)
    }
    // Why: focus fires on every app and window switch, and a forced refresh
    // bypasses every cache down to the host's disk walk — that is what turned an
    // alt-tab into a multi-root filesystem scan per window and per client. Focus,
    // and another surface finishing its own scan, are both only hints that
    // something may have changed, so they read through the freshness window.
    const refreshQuietly = (): void => {
      void refresh(false, false)
    }
    window.addEventListener('focus', refreshQuietly)
    window.addEventListener(INSTALLED_AGENT_SKILLS_CHANGED_EVENT, refreshFromInstall)
    window.addEventListener(INSTALLED_AGENT_SKILLS_REFRESHED_EVENT, refreshQuietly)
    return () => {
      window.removeEventListener('focus', refreshQuietly)
      window.removeEventListener(INSTALLED_AGENT_SKILLS_CHANGED_EVENT, refreshFromInstall)
      window.removeEventListener(INSTALLED_AGENT_SKILLS_REFRESHED_EVENT, refreshQuietly)
    }
  }, [enabled, refresh])

  // Why: an enabled hook owns request-generation ordering, so a concurrent cache write must not
  // bypass its stale-result guard. Passive consumers have no request of their own and read only
  // the last completed shared scan.
  const exposedResult = enabled ? resultForRender : readCachedWhenDisabled ? cachedDiscovery : null
  const skills = useMemo(() => exposedResult?.skills ?? [], [exposedResult])
  const sources = useMemo(() => exposedResult?.sources ?? [], [exposedResult])

  const installed = useMemo(
    () => hasInstalledAgentSkillNamed(skills, candidateSkillNames, { sourceKinds }),
    [candidateSkillNames, skills, sourceKinds]
  )

  const settled = exposedResult !== null
  const scan: InstalledAgentSkillScan = {
    enabled,
    installed,
    settled,
    error: errorForRender,
    sources,
    sourceKinds
  }

  useEffect(() => {
    if (installed && candidateSkillNames.some(isOrchestrationSkillName)) {
      // Why: older floating-workspace education still keys off this marker; any
      // surface that detects the orchestration skill should satisfy setup.
      markOrchestrationSetupComplete()
    }
  }, [candidateSkillNames, installed])

  const forceRefresh = useCallback(() => refresh(true), [refresh])

  return {
    installed,
    loading: loadingForRender,
    settled,
    ...getInstalledAgentSkillVerdict(scan),
    skills,
    sources,
    refresh: forceRefresh
  }
}
