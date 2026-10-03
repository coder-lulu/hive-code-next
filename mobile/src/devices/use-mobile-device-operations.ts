import { useEffect, useRef, useState } from 'react'
import type { HostCatalogEntry } from '../transport/types'
import { hostCatalogEntryHasLocalPairing } from '../runtime-directory/account-runtime-catalog'

export function useMobileDeviceOperations(args: {
  scope: string | null
  reloadCatalog: () => Promise<unknown>
  refreshDirectory: () => Promise<void>
  forceReconnect: ((id: string) => Promise<void>) | null
  pair: () => void
}) {
  const generation = useRef(0)
  const active = useRef(true)
  const scope = useRef(args.scope)
  scope.current = args.scope
  const busy = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    active.current = true
    generation.current += 1
    busy.current = false
    setRefreshing(false)
    setPendingId(null)
    setError(null)
    return () => {
      active.current = false
      generation.current += 1
    }
  }, [args.scope])

  const run = async (hostId: string | null, action: (current: () => boolean) => Promise<void>) => {
    const scopeMatches = () => active.current && scope.current === args.scope
    if (busy.current || !scopeMatches()) {
      return
    }
    busy.current = true
    const request = generation.current
    const current = () => request === generation.current && scopeMatches()
    setError(null)
    setRefreshing(hostId == null)
    setPendingId(hostId)
    try {
      await action(current)
    } catch (failure) {
      if (current()) {
        setError(failure instanceof Error ? failure.message : '连接操作失败，请重试')
      }
    } finally {
      if (current()) {
        busy.current = false
        setRefreshing(false)
        setPendingId(null)
      }
    }
  }
  return {
    refreshing,
    pendingId,
    error,
    refresh: () =>
      run(null, async (current) => {
        await args.refreshDirectory()
        if (!current()) {
          return
        }
        await args.reloadCatalog()
      }),
    retry: (host: HostCatalogEntry, requiresPairing = false) =>
      run(host.id, async (current) => {
        if (
          (requiresPairing || host.credentialStatus === 'missing') &&
          hostCatalogEntryHasLocalPairing(host) &&
          !host.profile?.accountRuntime
        ) {
          args.pair()
        } else if (host.credentialStatus !== 'ready' || !host.profile) {
          await args.refreshDirectory()
          if (current()) {
            await args.reloadCatalog()
          }
        } else {
          if (!args.forceReconnect) {
            throw new Error('当前页面无法重连 Runtime')
          }
          await args.forceReconnect(host.id)
        }
      })
  }
}
