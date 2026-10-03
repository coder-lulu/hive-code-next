import type { HostCatalogEntry, HostProfile } from './types'

export type HostListSnapshot = {
  catalog: HostCatalogEntry[]
  profiles: HostProfile[]
}

// Why: concurrent callers share a slow Keychain pass; durable writes invalidate
// it so later loads cannot receive stale snapshots (#8791).
let inflight: Promise<HostListSnapshot> | null = null
let revision = 0
let cached: { value: HostListSnapshot; loadedAt: number } | null = null

export function getHostListLoadRevision(): number {
  return revision
}

export function shareHostListLoad(
  load: () => Promise<HostListSnapshot>
): Promise<HostListSnapshot> {
  if (inflight) {
    return inflight
  }
  const now = Date.now()
  if (cached && now >= cached.loadedAt && now - cached.loadedAt < 30_000) {
    return Promise.resolve(cached.value)
  }
  const loadRevision = revision
  const started = load()
    .then((value) => {
      if (
        revision === loadRevision &&
        !value.catalog.some((entry) => entry.credentialStatus === 'temporarily-unavailable')
      ) {
        cached = { value, loadedAt: Date.now() }
      }
      return value
    })
    .finally(() => {
      // Why: a dropped pass can settle after its replacement started; only retire
      // the entry still on offer, or the replacement is silently discarded.
      if (inflight === started) {
        inflight = null
      }
    })
  inflight = started
  return started
}

/** Call after every durable host write so no later read is served a pre-write pass. */
export function dropSharedHostListLoad(): void {
  cached = null
  revision += 1
  inflight = null
}
