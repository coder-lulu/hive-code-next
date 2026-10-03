import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  normalizeAgentNpmRegistry,
  type AgentNpmRegistry
} from '../../../../shared/agent-npm-registry'
import type {
  AgentVersionResult,
  LatestAgentVersionResult
} from '../../../../shared/agent-version-types'

export type AgentVersionTarget = {
  environmentId: string | null
  platform: string
  wslDistro: string | null
  registry?: AgentNpmRegistry
}
export type AgentVersionQuery = {
  target: AgentVersionTarget
  agent: TuiAgent
  commandOverride?: string
}
export type AgentVersionSnapshot = {
  current: AgentVersionResult | null
  latest: LatestAgentVersionResult | null
  currentLoading: boolean
  latestLoading: boolean
}
type Entry = AgentVersionSnapshot & { currentAt: number; latestAt: number }
type Readers = {
  current: (query: AgentVersionQuery) => Promise<AgentVersionResult>
  latest: (query: AgentVersionQuery) => Promise<LatestAgentVersionResult>
}
const EMPTY: AgentVersionSnapshot = {
  current: null,
  latest: null,
  currentLoading: false,
  latestLoading: false
}

export function agentVersionQueryKey(query: AgentVersionQuery): string {
  return JSON.stringify([
    query.target.environmentId,
    query.target.platform,
    query.target.wslDistro,
    query.agent,
    query.commandOverride ?? '',
    normalizeAgentNpmRegistry(query.target.registry)
  ])
}

export function createAgentVersionCache(readers: Readers, now = Date.now) {
  const entries = new Map<string, Entry>()
  const pending = new Map<string, Promise<void>>()
  const retainedKeys = new Map<string, number>()
  const listeners = new Set<() => void>()
  const queue: (() => void)[] = []
  let running = 0
  let revision = 0
  const notify = () => {
    revision++
    for (const listener of listeners) {
      listener()
    }
  }
  const schedule = <T>(read: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const start = () => {
        running++
        void Promise.resolve()
          .then(read)
          .then(resolve, reject)
          .finally(() => {
            running--
            queue.shift()?.()
          })
      }
      if (running < 3) {
        start()
      } else {
        queue.push(start)
      }
    })
  const get = (query: AgentVersionQuery): AgentVersionSnapshot =>
    entries.get(agentVersionQueryKey(query)) ?? EMPTY
  const trim = (protectedKey?: string) => {
    if (entries.size <= 256) {
      return
    }
    let removed = false
    for (const [key, entry] of entries) {
      if (
        key !== protectedKey &&
        !retainedKeys.has(key) &&
        !entry.currentLoading &&
        !entry.latestLoading
      ) {
        entries.delete(key)
        removed = true
        if (entries.size <= 256) {
          break
        }
      }
    }
    if (removed) {
      notify()
    }
  }
  const request = (
    query: AgentVersionQuery,
    part: 'current' | 'latest',
    force: boolean
  ): Promise<void> => {
    const key = agentVersionQueryKey(query)
    const requestKey = `${key}:${part}`
    const inFlight = pending.get(requestKey)
    if (inFlight) {
      return inFlight
    }
    const entry = entries.get(key) ?? { ...EMPTY, currentAt: 0, latestAt: 0 }
    const cached = entry[part]
    const completedAt = part === 'current' ? entry.currentAt : entry.latestAt
    const ttl = cached?.status === 'error' ? 30_000 : part === 'current' ? 300_000 : 3_600_000
    if (!force && cached && now() - completedAt < ttl) {
      return Promise.resolve()
    }
    entries.set(key, { ...entry, [part === 'current' ? 'currentLoading' : 'latestLoading']: true })
    const operation = schedule(() => readers[part](query))
      .catch((error: unknown) =>
        part === 'latest'
          ? {
              status: 'error' as const,
              version: null,
              channel: 'npm-latest' as const,
              reason: error instanceof Error ? error.message.slice(0, 512) : 'version-read-failed'
            }
          : {
              status: 'error' as const,
              version: null,
              reason: error instanceof Error ? error.message.slice(0, 512) : 'version-read-failed'
            }
      )
      .then((result) => {
        const latestEntry = entries.get(key)!
        entries.set(key, {
          ...latestEntry,
          [part]: result,
          [part === 'current' ? 'currentAt' : 'latestAt']: now(),
          [part === 'current' ? 'currentLoading' : 'latestLoading']: false
        })
        notify()
      })
      .finally(() => {
        pending.delete(requestKey)
        trim(key)
      })
    pending.set(requestKey, operation)
    notify()
    return operation
  }
  return {
    get,
    retain: (query: AgentVersionQuery) => {
      const key = agentVersionQueryKey(query)
      retainedKeys.set(key, (retainedKeys.get(key) ?? 0) + 1)
      let released = false
      return () => {
        if (released) {
          return
        }
        released = true
        const remaining = retainedKeys.get(key)! - 1
        if (remaining > 0) {
          retainedKeys.set(key, remaining)
        } else {
          retainedKeys.delete(key)
          trim()
        }
      }
    },
    ensure: (query: AgentVersionQuery) =>
      Promise.all([request(query, 'current', false), request(query, 'latest', false)]),
    refresh: (query: AgentVersionQuery) =>
      Promise.all([request(query, 'current', true), request(query, 'latest', true)]),
    checkLatest: (query: AgentVersionQuery) => request(query, 'latest', true),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getRevision: () => revision
  }
}
