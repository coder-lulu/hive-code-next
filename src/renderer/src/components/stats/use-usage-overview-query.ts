import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClaudeUsageRange, ClaudeUsageSnapshot } from '../../../../shared/claude-usage-types'
import type { CodexUsageSnapshot } from '../../../../shared/codex-usage-types'
import type { OpenCodeUsageSnapshot } from '../../../../shared/opencode-usage-types'
import { useAppStore } from '../../store'

export type UsageSnapshots = {
  claude: ClaudeUsageSnapshot
  codex: CodexUsageSnapshot
  opencode: OpenCodeUsageSnapshot
}

export function useUsageOverviewQuery(range: ClaudeUsageRange, isActive: boolean) {
  const [data, setData] = useState<UsageSnapshots | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const generation = useRef(0)
  const initialScan = useRef<Promise<unknown> | null>(null)
  const load = useCallback(
    async (refresh = false) => {
      const request = ++generation.current
      setLoading(true)
      setError(false)
      try {
        if (refresh || !initialScan.current) {
          const store = useAppStore.getState()
          initialScan.current = Promise.allSettled([
            store.fetchClaudeUsage({ forceRefresh: refresh }),
            store.fetchCodexUsage({ forceRefresh: refresh }),
            store.fetchOpenCodeUsage({ forceRefresh: refresh })
          ])
        }
        // Cached snapshots remain readable while scans run; completion subscriptions refresh them.
        if (request !== generation.current) {
          return
        }
        const query = { scope: 'all' as const, range, limit: 100 }
        const [claude, codex, opencode] = await Promise.all([
          window.api.claudeUsage.getSnapshot(query),
          window.api.codexUsage.getSnapshot(query),
          window.api.openCodeUsage.getSnapshot(query)
        ])
        if (request !== generation.current) {
          return
        }
        if (!claude || !codex || !opencode) {
          throw new Error('Usage unavailable')
        }
        setData({ claude, codex, opencode })
      } catch {
        if (request === generation.current) {
          setData(null)
          setError(true)
        }
      } finally {
        if (request === generation.current) {
          setLoading(false)
        }
      }
    },
    [range]
  )
  const invalidate = useCallback(() => {
    generation.current++
  }, [])
  useEffect(() => {
    if (!isActive) {
      return invalidate
    }
    void load()
    let pending: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      const keys = [
        'claudeUsageScanState',
        'codexUsageScanState',
        'openCodeUsageScanState'
      ] as const
      const changed = keys.some((key) => {
        const next = state[key]
        const before = previous[key]
        return (
          next &&
          (next.isScanning !== before?.isScanning ||
            next.enabled !== before?.enabled ||
            next.lastScanCompletedAt !== before?.lastScanCompletedAt ||
            next.lastScanError !== before?.lastScanError)
        )
      })
      if (!changed) {
        return
      }
      clearTimeout(pending)
      // Coalesce source state changes without restarting scans.
      pending = setTimeout(() => {
        void load()
      }, 50)
    })
    return () => {
      unsubscribe()
      clearTimeout(pending)
      invalidate()
    }
  }, [load, isActive, invalidate])
  return { data, loading, error, refresh: () => void load(true) }
}
