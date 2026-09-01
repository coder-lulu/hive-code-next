import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { normalizeExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import type {
  BuildDesktopHomeModelInput,
  DesktopHomeSession,
  DesktopHomeTab
} from './desktop-home-model-types'
import { stableSessions } from './desktop-home-model-utils'

function isFloatingOwner(value: string | undefined): boolean {
  return (
    value === FLOATING_TERMINAL_WORKTREE_ID ||
    value?.endsWith(`|${FLOATING_TERMINAL_WORKTREE_ID}`) === true
  )
}

function floatingOwnerHost(bucketKey: string): ExecutionHostId | undefined {
  const suffix = `|${FLOATING_TERMINAL_WORKTREE_ID}`
  if (!bucketKey.endsWith(suffix)) {
    return undefined
  }
  const host = bucketKey.slice(0, -suffix.length)
  return host ? (normalizeExecutionHostId(host) ?? undefined) : undefined
}

/** Keep synthetic floating tabs outside workspace projection until explicitly assigned. */
export function buildTemporarySessions(input: BuildDesktopHomeModelInput): DesktopHomeSession[] {
  const buckets = new Map<string, { host?: ExecutionHostId; tabs: DesktopHomeTab[] }>()
  const append = (
    source: Readonly<Record<string, readonly DesktopHomeTab[] | undefined>> | undefined
  ): void => {
    for (const [bucketKey, tabs] of Object.entries(source ?? {})) {
      const floatingTabs = (tabs ?? []).filter(
        (tab) => isFloatingOwner(bucketKey) || isFloatingOwner(tab.worktreeId)
      )
      if (floatingTabs.length === 0) {
        continue
      }
      const ownerKey = isFloatingOwner(bucketKey)
        ? bucketKey
        : (floatingTabs[0]?.worktreeId ?? FLOATING_TERMINAL_WORKTREE_ID)
      const bucket = buckets.get(ownerKey) ?? {
        host: floatingOwnerHost(ownerKey),
        tabs: []
      }
      bucket.tabs.push(...floatingTabs)
      buckets.set(ownerKey, bucket)
    }
  }
  append(input.unifiedTabsByWorktree)
  append(input.tabsByWorktree)

  const seen = new Set<string>()
  return [...buckets.values()]
    .flatMap((bucket) =>
      stableSessions(
        bucket.tabs,
        null,
        0,
        bucket.host ? { executionHostId: bucket.host } : undefined
      )
    )
    .filter((session) => {
      const identity = `${session.executionHostId ?? 'local'}|${session.id}`
      if (seen.has(identity)) {
        return false
      }
      seen.add(identity)
      return true
    })
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
}
