import type { TerminalLayoutSnapshot } from '../../../shared/terminal-tab-types'
import { LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS } from '../../../shared/pty-startup-timeouts'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'

/** The renderer must never turn an unavailable liveness probe into data loss. */
export type PersistedPtyLivenessResolver = (ptyId: string) => Promise<boolean | null>

// The main-process liveness handler deliberately waits for the provider swap.
// Give it longer than that authoritative gate so a slow-but-successful daemon
// cannot be converted into an unknown verdict just before hydration.
export const STARTUP_PTY_LIVENESS_TIMEOUT_MS = LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS + 5_000
// A pathological session with hundreds of bindings must not serialize startup
// behind one probe batch after the per-probe grace has elapsed.
export const STARTUP_PTY_LIVENESS_TOTAL_TIMEOUT_MS = STARTUP_PTY_LIVENESS_TIMEOUT_MS + 5_000
const STARTUP_PTY_LIVENESS_CONCURRENCY = 16

function defaultPersistedPtyLivenessResolver(ptyId: string): Promise<boolean | null> {
  try {
    const hasPty = typeof window !== 'undefined' ? window.api?.pty?.hasPty : undefined
    if (!hasPty) {
      return Promise.resolve(null)
    }
    return Promise.resolve(hasPty(ptyId)).then(
      (verdict) => (verdict === true || verdict === false ? verdict : null),
      () => null
    )
  } catch {
    return Promise.resolve(null)
  }
}

async function resolvePtyLivenessWithTimeout(
  ptyId: string,
  resolve: PersistedPtyLivenessResolver,
  signal?: AbortSignal
): Promise<boolean | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let handleAbort: (() => void) | undefined
  try {
    const candidates: Promise<boolean | null>[] = [
      Promise.resolve()
        .then(() => resolve(ptyId))
        .then(
          (verdict) => (verdict === true || verdict === false ? verdict : null),
          () => null
        ),
      new Promise<null>((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout(null), STARTUP_PTY_LIVENESS_TIMEOUT_MS)
      })
    ]
    if (signal) {
      candidates.push(
        new Promise<null>((resolveAbort) => {
          if (signal.aborted) {
            resolveAbort(null)
            return
          }
          handleAbort = () => resolveAbort(null)
          signal.addEventListener('abort', handleAbort, { once: true })
        })
      )
    }
    return await Promise.race(candidates)
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
    if (handleAbort && signal) {
      signal.removeEventListener('abort', handleAbort)
    }
  }
}

function collectPersistedPtyIds(session: WorkspaceSessionState): string[] {
  const ids = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) {
      ids.add(value)
    }
  }

  for (const tabs of Object.values(session.tabsByWorktree)) {
    for (const tab of tabs) {
      add(tab.ptyId)
    }
  }
  for (const ptyId of Object.values(session.remoteSessionIdsByTabId ?? {})) {
    add(ptyId)
  }
  for (const layout of Object.values(session.terminalLayoutsByTabId)) {
    for (const ptyId of Object.values(layout.ptyIdsByLeafId ?? {})) {
      add(ptyId)
    }
  }
  return [...ids]
}

export function collectRemovedPersistedPtyIds(
  original: WorkspaceSessionState,
  sanitized: WorkspaceSessionState
): Set<string> {
  const retainedPtyIds = new Set(collectPersistedPtyIds(sanitized))
  return new Set(collectPersistedPtyIds(original).filter((ptyId) => !retainedPtyIds.has(ptyId)))
}

function sanitizeTabsByWorktree(
  tabsByWorktree: WorkspaceSessionState['tabsByWorktree'],
  deadPtyIds: ReadonlySet<string>
): WorkspaceSessionState['tabsByWorktree'] {
  let next = tabsByWorktree
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    const nextTabs = tabs.map((tab) =>
      tab.ptyId && deadPtyIds.has(tab.ptyId) ? { ...tab, ptyId: null } : tab
    )
    if (nextTabs.every((tab, index) => tab === tabs[index])) {
      continue
    }
    if (next === tabsByWorktree) {
      next = { ...tabsByWorktree }
    }
    next[worktreeId] = nextTabs
  }
  return next
}

function sanitizeTerminalLayouts(
  layoutsByTabId: WorkspaceSessionState['terminalLayoutsByTabId'],
  deadPtyIds: ReadonlySet<string>
): WorkspaceSessionState['terminalLayoutsByTabId'] {
  let next = layoutsByTabId
  for (const [tabId, layout] of Object.entries(layoutsByTabId)) {
    const bindings = layout.ptyIdsByLeafId
    if (!bindings) {
      continue
    }
    const keptBindings = Object.fromEntries(
      Object.entries(bindings).filter(([, ptyId]) => !deadPtyIds.has(ptyId))
    )
    if (Object.keys(keptBindings).length === Object.keys(bindings).length) {
      continue
    }
    if (next === layoutsByTabId) {
      next = { ...layoutsByTabId }
    }
    const sanitizedLayout: TerminalLayoutSnapshot = {
      ...layout,
      ptyIdsByLeafId: keptBindings
    }
    next[tabId] = sanitizedLayout
  }
  return next
}

function sanitizeRemoteSessionIds(
  remoteSessionIdsByTabId: WorkspaceSessionState['remoteSessionIdsByTabId'],
  deadPtyIds: ReadonlySet<string>
): WorkspaceSessionState['remoteSessionIdsByTabId'] {
  if (!remoteSessionIdsByTabId) {
    return remoteSessionIdsByTabId
  }
  const entries = Object.entries(remoteSessionIdsByTabId)
  const kept = entries.filter(([, ptyId]) => !deadPtyIds.has(ptyId))
  if (kept.length === entries.length) {
    return remoteSessionIdsByTabId
  }
  const next = Object.fromEntries(kept)
  return Object.keys(next).length > 0 ? next : undefined
}

async function resolveAllPersistedPtyLiveness(
  persistedPtyIds: readonly string[],
  resolveLiveness: PersistedPtyLivenessResolver
): Promise<readonly (readonly [string, boolean | null])[]> {
  const verdicts = Array.from<readonly [string, boolean | null] | undefined>({
    length: persistedPtyIds.length
  })
  const controller = new AbortController()
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(STARTUP_PTY_LIVENESS_CONCURRENCY, persistedPtyIds.length) },
    async () => {
      while (!controller.signal.aborted) {
        const index = nextIndex
        nextIndex += 1
        const ptyId = persistedPtyIds[index]
        if (ptyId === undefined) {
          return
        }
        const verdict = await resolvePtyLivenessWithTimeout(
          ptyId,
          resolveLiveness,
          controller.signal
        )
        if (!controller.signal.aborted) {
          verdicts[index] = [ptyId, verdict]
        }
      }
    }
  )
  const completion = Promise.all(workers)
  let timeout: ReturnType<typeof setTimeout> | undefined
  let totalTimedOut = false
  try {
    await Promise.race([
      completion,
      new Promise<void>((resolveTimeout) => {
        timeout = setTimeout(() => {
          totalTimedOut = true
          resolveTimeout()
        }, STARTUP_PTY_LIVENESS_TOTAL_TIMEOUT_MS)
      })
    ])
    if (totalTimedOut) {
      controller.abort()
      // Aborting releases every in-flight per-probe race. Await the workers so
      // none can schedule another resolver call after this function returns.
      await completion
    }
    return verdicts.filter(
      (entry): entry is readonly [string, boolean | null] => entry !== undefined
    )
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

/**
 * Remove only PTY bindings whose owner explicitly reports that they are gone.
 * Remote/unavailable providers return `null` and are retained for their normal
 * reconnect path, so startup cleanup cannot accidentally delete a valid session.
 */
export async function sanitizePersistedTerminalSessionForStartup(
  session: WorkspaceSessionState,
  resolveLiveness: PersistedPtyLivenessResolver = defaultPersistedPtyLivenessResolver
): Promise<WorkspaceSessionState> {
  const persistedPtyIds = collectPersistedPtyIds(session)
  if (persistedPtyIds.length === 0) {
    return session
  }

  const verdicts = await resolveAllPersistedPtyLiveness(persistedPtyIds, resolveLiveness)
  const deadPtyIds = new Set(
    verdicts.filter(([, verdict]) => verdict === false).map(([ptyId]) => ptyId)
  )
  if (deadPtyIds.size === 0) {
    return session
  }

  const tabsByWorktree = sanitizeTabsByWorktree(session.tabsByWorktree, deadPtyIds)
  const terminalLayoutsByTabId = sanitizeTerminalLayouts(session.terminalLayoutsByTabId, deadPtyIds)
  const remoteSessionIdsByTabId = sanitizeRemoteSessionIds(
    session.remoteSessionIdsByTabId,
    deadPtyIds
  )
  return {
    ...session,
    ...(tabsByWorktree !== session.tabsByWorktree ? { tabsByWorktree } : {}),
    ...(terminalLayoutsByTabId !== session.terminalLayoutsByTabId
      ? { terminalLayoutsByTabId }
      : {}),
    ...(remoteSessionIdsByTabId !== session.remoteSessionIdsByTabId
      ? { remoteSessionIdsByTabId }
      : {})
  }
}

export type PersistedTerminalSessionSanitization = {
  completion: Promise<WorkspaceSessionState>
  readCompleted: () => WorkspaceSessionState | null
}

/** Start the authoritative probe without making base session hydration wait for it. */
export function startPersistedTerminalSessionSanitization(
  session: WorkspaceSessionState,
  resolveLiveness: PersistedPtyLivenessResolver = defaultPersistedPtyLivenessResolver
): PersistedTerminalSessionSanitization {
  let completed: WorkspaceSessionState | null = null
  const completion = sanitizePersistedTerminalSessionForStartup(session, resolveLiveness).then(
    (sanitized) => {
      completed = sanitized
      return sanitized
    }
  )
  return { completion, readCompleted: () => completed }
}
