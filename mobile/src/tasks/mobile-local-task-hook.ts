import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState, RpcResponse } from '../transport/types'
import {
  projectMobileLocalTaskGroups,
  type MobileLocalSessionSnapshot,
  type MobileLocalTaskGroups,
  type MobileLocalWorktreeMetadata
} from './mobile-local-task-model'
import {
  parseMobileLocalSessionInventory,
  parseMobileLocalSessionUpdate,
  parseMobileLocalWorktreeMetadata
} from './mobile-local-task-rpc'
import {
  applyMobileLocalSessionUpdate,
  mergeMobileLocalSessionInventory
} from './mobile-local-task-snapshots'

const WORKTREE_PS_FULL_LIMIT = 10_000

type MobileLocalTaskSourceState = {
  client: RpcClient | null
  snapshots: MobileLocalSessionSnapshot[]
  worktrees: MobileLocalWorktreeMetadata[]
  listLoaded: boolean
  streamLoaded: boolean
  listPending: boolean
  metadataPending: boolean
  listError: string | null
  streamError: string | null
  metadataError: string | null
}

export type MobileLocalTaskFeedPhase = 'loading' | 'ready' | 'error' | 'disconnected'

export type MobileLocalTaskFeed = MobileLocalTaskGroups & {
  phase: MobileLocalTaskFeedPhase
  isVerifiable: boolean
  refreshing: boolean
  error: string | null
  metadataError: string | null
  /** Re-reads both the session inventory and worktree metadata from the current Runtime. */
  refresh: () => void
  reload: () => void
}

function emptySourceState(client: RpcClient | null): MobileLocalTaskSourceState {
  return {
    client,
    snapshots: [],
    worktrees: [],
    listLoaded: false,
    streamLoaded: false,
    listPending: false,
    metadataPending: false,
    listError: null,
    streamError: null,
    metadataError: null
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

function successfulResult(response: RpcResponse, label: string): unknown {
  if (!response.ok) {
    throw new Error(response.error.message || `${label} failed.`)
  }
  return response.result
}

function streamFailureMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const row = value as { type?: unknown; message?: unknown }
  if (row.type !== 'error' && row.type !== 'end') {
    return null
  }
  if (typeof row.message === 'string' && row.message.trim()) {
    return row.message.trim()
  }
  return row.type === 'end' ? '本地任务实时订阅已结束。' : '本地任务实时订阅失败。'
}

/**
 * Reads the current Runtime's explicit terminal agent statuses. The previous snapshot stays visible
 * through a transport disconnect, but every retained row is projected as unverifiable.
 */
export function useMobileLocalTasks(args: {
  client: RpcClient | null
  connectionState: ConnectionState
  recentLimit?: number
}): MobileLocalTaskFeed {
  const { client, connectionState, recentLimit } = args
  const [source, setSource] = useState<MobileLocalTaskSourceState>(() => emptySourceState(client))
  const [reloadRevision, setReloadRevision] = useState(0)
  const generationRef = useRef(0)

  const reload = useCallback(() => {
    setReloadRevision((revision) => revision + 1)
  }, [])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    let active = true
    let unsubscribe: (() => void) | null = null
    let streamEstablished = false

    const commit = (
      update: (current: MobileLocalTaskSourceState) => MobileLocalTaskSourceState
    ): void => {
      if (!active || generationRef.current !== generation) {
        return
      }
      setSource((previous) =>
        update(previous.client === client ? previous : emptySourceState(client))
      )
    }

    if (!client) {
      commit(() => emptySourceState(null))
      return () => {
        active = false
      }
    }

    if (connectionState !== 'connected') {
      commit((current) => ({ ...current, listPending: false, metadataPending: false }))
      return () => {
        active = false
      }
    }

    commit((current) => ({
      ...current,
      listPending: true,
      metadataPending: true,
      listLoaded: false,
      streamLoaded: false,
      listError: null,
      streamError: null,
      metadataError: null
    }))

    const handleStreamValue = (value: unknown): void => {
      if (!active || generationRef.current !== generation) {
        return
      }
      const failure = streamFailureMessage(value)
      if (failure) {
        commit((current) => ({
          ...current,
          streamError: failure
        }))
        return
      }
      if (!value || typeof value !== 'object') {
        return
      }
      const row = value as { type?: unknown }
      try {
        if (row.type === 'snapshots') {
          const inventory = parseMobileLocalSessionInventory(value)
          streamEstablished = true
          commit((current) => ({
            ...current,
            snapshots: mergeMobileLocalSessionInventory(current.snapshots, inventory),
            streamLoaded: true,
            streamError: null
          }))
          return
        }
        if (row.type === 'updated') {
          const update = parseMobileLocalSessionUpdate(value)
          if (!update) {
            throw new Error('Runtime returned an invalid session tab update.')
          }
          streamEstablished = true
          commit((current) => ({
            ...current,
            snapshots: applyMobileLocalSessionUpdate(current.snapshots, update),
            streamLoaded: true,
            streamError: null
          }))
        }
      } catch (error) {
        commit((current) => ({
          ...current,
          streamError: errorMessage(error, '本地任务实时订阅返回了无效数据。')
        }))
      }
    }

    try {
      unsubscribe = client.subscribe('session.tabs.subscribeAll', null, handleStreamValue)
    } catch (error) {
      commit((current) => ({
        ...current,
        streamError: errorMessage(error, '无法订阅本地任务。')
      }))
    }

    void client
      .sendRequest('session.tabs.listAll')
      .then((response) => {
        const inventory = parseMobileLocalSessionInventory(
          successfulResult(response, 'session.tabs.listAll')
        )
        commit((current) => ({
          ...current,
          // subscribeAll begins with its own race-safe census. Once that has landed, a slower
          // listAll response must not overwrite a newer stream publication.
          snapshots: streamEstablished
            ? current.snapshots
            : mergeMobileLocalSessionInventory(current.snapshots, inventory),
          listLoaded: true,
          listPending: false,
          listError: null
        }))
      })
      .catch((error) => {
        commit((current) => ({
          ...current,
          listPending: false,
          listError: errorMessage(error, '无法加载本地任务。')
        }))
      })

    void client
      .sendRequest('worktree.ps', { limit: WORKTREE_PS_FULL_LIMIT })
      .then((response) => {
        const worktrees = parseMobileLocalWorktreeMetadata(
          successfulResult(response, 'worktree.ps')
        )
        commit((current) => ({
          ...current,
          worktrees,
          metadataPending: false,
          metadataError: null
        }))
      })
      .catch((error) => {
        commit((current) => ({
          ...current,
          metadataPending: false,
          metadataError: errorMessage(error, '无法加载工作区信息。')
        }))
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [client, connectionState, reloadRevision])

  // Mask data synchronously while React is committing a client change. This prevents even one
  // render of host A's rows under host B while the effect above retires host A's requests.
  const visibleSource = source.client === client ? source : emptySourceState(client)
  const connected = Boolean(client && connectionState === 'connected')
  const loaded = visibleSource.listLoaded || visibleSource.streamLoaded
  const error =
    visibleSource.streamError ??
    (!visibleSource.streamLoaded && !visibleSource.listLoaded ? visibleSource.listError : null)
  const isVerifiable = connected && loaded && visibleSource.streamError === null
  const groups = useMemo(
    () =>
      projectMobileLocalTaskGroups({
        snapshots: visibleSource.snapshots,
        worktrees: visibleSource.worktrees,
        sourceVerifiable: isVerifiable,
        recentLimit
      }),
    [isVerifiable, recentLimit, visibleSource.snapshots, visibleSource.worktrees]
  )
  const phase: MobileLocalTaskFeedPhase = !connected
    ? 'disconnected'
    : !loaded && error
      ? 'error'
      : !loaded
        ? 'loading'
        : 'ready'

  return {
    ...groups,
    phase,
    isVerifiable,
    refreshing: connected && (visibleSource.listPending || visibleSource.metadataPending),
    error,
    metadataError: visibleSource.metadataError,
    refresh: reload,
    reload
  }
}
