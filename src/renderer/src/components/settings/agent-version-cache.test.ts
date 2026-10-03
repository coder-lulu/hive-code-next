import { describe, expect, it, vi } from 'vitest'
import type {
  AgentVersionResult,
  LatestAgentVersionResult
} from '../../../../shared/agent-version-types'
import {
  agentVersionQueryKey,
  createAgentVersionCache,
  type AgentVersionQuery
} from './agent-version-cache'
import { getAgentUpdateStatus } from './AgentVersionInformation'

const query: AgentVersionQuery = {
  target: { environmentId: null, platform: 'win32', wslDistro: null },
  agent: 'codex'
}
const current: AgentVersionResult = { status: 'ready', version: '1.10.0' }
const latest: LatestAgentVersionResult = {
  status: 'ready',
  version: '1.11.0',
  channel: 'npm-latest'
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Agent versions cache', () => {
  it('retains actionable reader failure reasons independently', async () => {
    const cache = createAgentVersionCache({
      current: async () => {
        throw new Error('CLI version command timed out')
      },
      latest: async () => {
        throw new Error('npm registry request failed')
      }
    })
    await cache.ensure(query)
    expect(cache.get(query).current?.reason).toBe('CLI version command timed out')
    expect(cache.get(query).latest?.reason).toBe('npm registry request failed')
  })
  it('reuses requests and keeps version-read and upstream errors independent', async () => {
    const read = deferred<AgentVersionResult>()
    const upstream = deferred<LatestAgentVersionResult>()
    const readers = { current: vi.fn(() => read.promise), latest: vi.fn(() => upstream.promise) }
    const cache = createAgentVersionCache(readers)
    const first = cache.ensure(query)
    const repeated = cache.ensure(query)
    await Promise.resolve()
    expect(readers.current).toHaveBeenCalledTimes(1)
    expect(readers.latest).toHaveBeenCalledTimes(1)
    read.resolve(current)
    upstream.resolve({ status: 'error', version: null, channel: 'npm-latest' })
    await Promise.all([first, repeated])
    expect(cache.get(query).current).toEqual(current)
    expect(cache.get(query).latest?.status).toBe('error')
    expect(cache.get(query).currentLoading).toBe(false)
  })

  it('isolates late responses after switching the environment, WSL distro and command', async () => {
    const slow = deferred<AgentVersionResult>()
    const remote = { ...query, target: { ...query.target, environmentId: 'runtime-b' } }
    const wsl = { ...query, target: { ...query.target, wslDistro: 'Ubuntu' } }
    const distro = { ...wsl, target: { ...wsl.target, wslDistro: 'Debian' } }
    const overridden = { ...query, commandOverride: 'C:\\agent\\codex.exe' }
    const mirrored = { ...query, target: { ...query.target, registry: 'china' as const } }
    const variants = [query, remote, wsl, distro, overridden, mirrored]
    expect(new Set(variants.map(agentVersionQueryKey)).size).toBe(6)
    expect(agentVersionQueryKey(query)).toBe(
      agentVersionQueryKey({ ...query, target: { ...query.target, registry: 'default' } })
    )
    const cache = createAgentVersionCache({
      current: (request) =>
        request === query ? slow.promise : Promise.resolve({ ...current, version: '2.0.0' }),
      latest: async () => latest
    })
    const old = cache.ensure(query)
    await Promise.all(variants.slice(1).map((request) => cache.ensure(request)))
    slow.resolve(current)
    await old
    expect(cache.get(query).current?.version).toBe('1.10.0')
    for (const request of variants.slice(1)) {
      expect(cache.get(request).current?.version).toBe('2.0.0')
    }
  })

  it('limits concurrency across version reads and upstream queries', async () => {
    const gate = deferred<void>()
    let active = 0
    let peak = 0
    const read = async () => {
      active++
      peak = Math.max(peak, active)
      await gate.promise
      active--
      return current
    }
    const cache = createAgentVersionCache({
      current: read,
      latest: async () => ({ ...(await read()), channel: 'npm-latest' })
    })
    const requests = ['claude', 'codex', 'gemini', 'pi'].map((agent) =>
      cache.ensure({ ...query, agent: agent as AgentVersionQuery['agent'] })
    )
    await Promise.resolve()
    expect(active).toBe(3)
    gate.resolve()
    await Promise.all(requests)
    expect(peak).toBe(3)
  })

  it('reuses cached values across tab changes and checks updates without rereading installed versions', async () => {
    let now = 1_000
    const readers = { current: vi.fn(async () => current), latest: vi.fn(async () => latest) }
    const cache = createAgentVersionCache(readers, () => now)
    await cache.ensure(query)
    await cache.ensure(query)
    expect(readers.current).toHaveBeenCalledTimes(1)
    expect(readers.latest).toHaveBeenCalledTimes(1)
    await cache.checkLatest(query)
    expect(readers.current).toHaveBeenCalledTimes(1)
    expect(readers.latest).toHaveBeenCalledTimes(2)
    now += 300_001
    await cache.ensure(query)
    expect(readers.current).toHaveBeenCalledTimes(2)
    expect(readers.latest).toHaveBeenCalledTimes(2)
  })

  it('preserves the current version while retrying a failed latest query', async () => {
    const retry = deferred<LatestAgentVersionResult>()
    const readers = {
      current: vi.fn(async () => current),
      latest: vi
        .fn<() => Promise<LatestAgentVersionResult>>()
        .mockResolvedValueOnce({ status: 'error', version: null, channel: 'npm-latest' })
        .mockImplementationOnce(() => retry.promise)
    }
    const cache = createAgentVersionCache(readers)
    await cache.ensure(query)
    const checking = cache.checkLatest(query)
    expect(cache.get(query).current?.version).toBe(current.version)
    expect(cache.get(query).latestLoading).toBe(true)
    retry.resolve(latest)
    await checking
    expect(cache.get(query).latest?.version).toBe(latest.version)
  })

  it('protects shared mounted queries while keeping unused entries eligible for eviction', async () => {
    const cache = createAgentVersionCache({
      current: async () => current,
      latest: async () => latest
    })
    const releaseFirst = cache.retain(query)
    const releaseSecond = cache.retain(query)
    await cache.ensure(query)
    const unused = { ...query, commandOverride: 'codex-0' }
    for (let index = 0; index < 256; index++) {
      await cache.ensure({ ...query, commandOverride: `codex-${index}` })
    }
    expect(cache.get(query).current).toEqual(current)
    expect(cache.get(unused).current).toBeNull()

    releaseFirst()
    releaseFirst()
    await cache.ensure({ ...query, commandOverride: 'codex-256' })
    expect(cache.get(query).current).toEqual(current)

    releaseSecond()
    await cache.ensure({ ...query, commandOverride: 'codex-257' })
    expect(cache.get(query).current).toBeNull()
  })
})

describe('Agent update channel comparison', () => {
  it.each([
    ['1.2.0', '1.10.0', 'update'],
    ['1.10.0', '1.2.0', 'newer'],
    ['1.10.0', '1.10.0', 'latest'],
    ['1.10.0-beta.2', '1.10.0', 'channel'],
    ['nightly', '1.10.0', 'unknown'],
    [null, '1.10.0', 'unknown']
  ])('compares %s and %s accurately', (installed, upstream, expected) => {
    expect(getAgentUpdateStatus(installed, upstream)).toBe(expected)
  })
})
