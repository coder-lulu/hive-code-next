import type { SkillDiscoveryResult } from '../../../shared/skills'

// Bound runtime/project keys accumulated across long renderer sessions to recent targets.
export const INSTALLED_AGENT_SKILL_DISCOVERY_CACHE_MAX = 256

// Expire focus-read caches so externally installed skills appear; match freshness inventory’s focus cooldown.
export const INSTALLED_AGENT_SKILL_DISCOVERY_FRESH_MS = 15_000

type CachedDiscovery = { result: SkillDiscoveryResult; expiresAt: number }

let cachedDiscoveryByTarget = new Map<string, CachedDiscovery>()
const cacheListenersByTarget = new Map<string, Set<() => void>>()

function publishCacheChange(key: string): void {
  for (const listener of cacheListenersByTarget.get(key) ?? []) {
    listener()
  }
}

export function subscribeInstalledAgentSkillDiscoveryCache(
  key: string,
  listener: () => void
): () => void {
  const listeners = cacheListenersByTarget.get(key) ?? new Set()
  listeners.add(listener)
  cacheListenersByTarget.set(key, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      cacheListenersByTarget.delete(key)
    }
  }
}

function readUnexpired(key: string): CachedDiscovery | null {
  const cached = cachedDiscoveryByTarget.get(key)
  if (!cached) {
    return null
  }
  if (cached.expiresAt <= Date.now()) {
    cachedDiscoveryByTarget.delete(key)
    return null
  }
  return cached
}

// Why: render reads must not reorder recency — React can discard a render pass.
export function peekInstalledAgentSkillDiscoveryCache(key: string): SkillDiscoveryResult | null {
  // Serve expired last-known results during refresh instead of flashing empty.
  return cachedDiscoveryByTarget.get(key)?.result ?? null
}

export function readInstalledAgentSkillDiscoveryCache(key: string): SkillDiscoveryResult | null {
  const cached = readUnexpired(key)
  if (!cached) {
    return null
  }
  cachedDiscoveryByTarget.delete(key)
  cachedDiscoveryByTarget.set(key, cached)
  return cached.result
}

export function writeInstalledAgentSkillDiscoveryCache(
  key: string,
  result: SkillDiscoveryResult
): void {
  cachedDiscoveryByTarget.delete(key)
  cachedDiscoveryByTarget.set(key, {
    result,
    expiresAt: Date.now() + INSTALLED_AGENT_SKILL_DISCOVERY_FRESH_MS
  })
  while (cachedDiscoveryByTarget.size > INSTALLED_AGENT_SKILL_DISCOVERY_CACHE_MAX) {
    const oldestKey = cachedDiscoveryByTarget.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    cachedDiscoveryByTarget.delete(oldestKey)
    publishCacheChange(oldestKey)
  }
  publishCacheChange(key)
}

export function clearInstalledAgentSkillDiscoveryCache(): void {
  const changedKeys = [...cachedDiscoveryByTarget.keys()]
  cachedDiscoveryByTarget.clear()
  for (const key of changedKeys) {
    publishCacheChange(key)
  }
}

export function deleteInstalledAgentSkillDiscoveryCache(matches: (key: string) => boolean): void {
  for (const key of cachedDiscoveryByTarget.keys()) {
    if (matches(key)) {
      cachedDiscoveryByTarget.delete(key)
    }
  }
}

export function getInstalledAgentSkillDiscoveryCacheSizeForTests(): number {
  return cachedDiscoveryByTarget.size
}

export function hasInstalledAgentSkillDiscoveryCacheEntryForTests(key: string): boolean {
  return cachedDiscoveryByTarget.has(key)
}

export function resetInstalledAgentSkillDiscoveryCacheForTests(): void {
  cachedDiscoveryByTarget = new Map()
  cacheListenersByTarget.clear()
}
