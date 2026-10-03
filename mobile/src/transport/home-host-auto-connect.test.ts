import { describe, expect, it, vi } from 'vitest'
import type { ConnectionState, HostProfile } from './types'
import {
  advanceHomeAutoConnectProgress,
  EMPTY_HOME_AUTO_CONNECT_PROGRESS,
  HOME_AUTO_CONNECT_CONCURRENCY,
  resolveHomeHostConnectionState,
  selectHomeAutoConnectHostIds
} from './home-host-auto-connect'

function host(id: string, lastConnected: number, credentials = true): HostProfile {
  return {
    id,
    name: id,
    endpoint: `ws://${id}`,
    deviceToken: credentials ? `token-${id}` : '',
    publicKeyB64: credentials ? `key-${id}` : '',
    lastConnected
  }
}

describe('home host auto-connect', () => {
  it('checks every credentialed host in most-recent order', () => {
    const hosts = [
      host('old', 1),
      host('newest', 5),
      host('second', 4),
      host('third', 3),
      host('fourth', 2),
      host('missing-credentials', 6, false)
    ]

    expect(selectHomeAutoConnectHostIds(hosts)).toEqual([
      'newest',
      'second',
      'third',
      'fourth',
      'old'
    ])
  })

  it('does not mutate the host card order', () => {
    const hosts = [host('old', 1), host('new', 2)]

    selectHomeAutoConnectHostIds(hosts)

    expect(hosts.map((item) => item.id)).toEqual(['old', 'new'])
  })

  it('includes ready account runtimes without requesting a ticket during selection', () => {
    const createConnection = vi.fn(async () => {
      throw new Error('not called')
    })
    const cloud = {
      ...host('cloud', 10, false),
      accountRuntime: {
        runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        resourceVersion: 1,
        createConnection
      }
    }

    expect(selectHomeAutoConnectHostIds([cloud, host('local', 1)])).toEqual(['cloud', 'local'])
    expect(createConnection).not.toHaveBeenCalled()
  })

  it('advances through every Runtime after each first attempt settles', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e']
    const states = new Map<string, ConnectionState>()
    let progress = advanceHomeAutoConnectProgress(
      candidates,
      EMPTY_HOME_AUTO_CONNECT_PROGRESS,
      (id) => states.get(id) ?? null
    )
    expect(progress.started).toEqual(['a', 'b', 'c'])
    expect(progress.pending).toEqual(['a', 'b', 'c'])
    expect(progress.failed).toEqual([])
    expect(progress.started).toHaveLength(HOME_AUTO_CONNECT_CONCURRENCY)

    states.set('a', 'connecting')
    states.set('b', 'handshaking')
    states.set('c', 'connecting')
    expect(
      advanceHomeAutoConnectProgress(candidates, progress, (id) => states.get(id) ?? null)
    ).toBe(progress)

    states.set('a', 'connected')
    states.set('c', 'reconnecting')
    progress = advanceHomeAutoConnectProgress(candidates, progress, (id) => states.get(id) ?? null)
    expect(progress.started).toEqual(candidates)
    expect(progress.pending).toEqual(['b', 'd', 'e'])
    expect(progress.failed).toEqual([])
    expect(progress.retrying).toEqual(['c'])

    states.set('a', 'connecting')
    states.set('d', 'connected')
    states.set('e', 'auth-failed')
    progress = advanceHomeAutoConnectProgress(candidates, progress, (id) => states.get(id) ?? null)
    expect(progress.started).toEqual(candidates)
    expect(progress.pending).toEqual(['b'])
    expect(progress.failed).toEqual([])
    expect(progress.retrying).toEqual(['c'])
  })

  it('releases failed first attempts instead of retaining their retry clients', () => {
    const candidates = ['a', 'b', 'c', 'd']
    const started = advanceHomeAutoConnectProgress(
      candidates,
      EMPTY_HOME_AUTO_CONNECT_PROGRESS,
      () => null
    )
    const fourthStarted = advanceHomeAutoConnectProgress(candidates, started, (id) =>
      id === 'a' ? 'connected' : 'connecting'
    )
    const next = advanceHomeAutoConnectProgress(candidates, fourthStarted, (id) =>
      id === 'd' ? null : 'connecting'
    )
    expect(next.started).toEqual(candidates)
    expect(next.pending).toEqual(['b', 'c'])
    expect(next.failed).toEqual(['d'])
  })

  it('preserves retry ownership for the original recent-host batch', () => {
    const candidates = ['a', 'b', 'c', 'd']
    const started = advanceHomeAutoConnectProgress(
      candidates,
      EMPTY_HOME_AUTO_CONNECT_PROGRESS,
      () => null
    )
    const next = advanceHomeAutoConnectProgress(candidates, started, (id) =>
      id === 'a' ? 'reconnecting' : 'connecting'
    )
    expect(next.started).toEqual(candidates)
    expect(next.pending).toEqual(['b', 'c', 'd'])
    expect(next.failed).toEqual([])
    expect(next.retrying).toEqual(['a'])
  })

  it('keeps settled connections out of the pending poll and handles candidate reordering', () => {
    const candidates = ['a', 'b', 'c', 'd', 'e']
    const started = advanceHomeAutoConnectProgress(
      candidates,
      EMPTY_HOME_AUTO_CONNECT_PROGRESS,
      () => null
    )
    const settled = advanceHomeAutoConnectProgress(candidates, started, (id) =>
      id === 'a' ? 'connected' : 'connecting'
    )
    const stateOf = vi.fn((id: string) => (id === 'b' ? 'connected' : 'connecting'))
    const reordered = advanceHomeAutoConnectProgress(['e', 'a', 'b', 'c', 'd'], settled, stateOf)
    expect(reordered.started).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(reordered.pending).toEqual(['c', 'd', 'e'])
    expect(stateOf).toHaveBeenCalledTimes(3)
  })

  it('polls only the active batch even after a large catalog has been checked', () => {
    const candidates = Array.from({ length: 1_000 }, (_, index) => `host-${index}`)
    let progress = EMPTY_HOME_AUTO_CONNECT_PROGRESS
    while (progress.started.length < candidates.length) {
      progress = advanceHomeAutoConnectProgress(candidates, progress, () => 'connected')
    }
    const stateOf = vi.fn((): ConnectionState => 'connected')
    advanceHomeAutoConnectProgress(candidates, progress, stateOf)
    expect(stateOf.mock.calls.length).toBeLessThanOrEqual(HOME_AUTO_CONNECT_CONCURRENCY)
  })

  it('drops removed hosts before scheduling replacements', () => {
    const candidates = ['a', 'b', 'c', 'd']
    const started = advanceHomeAutoConnectProgress(
      candidates,
      EMPTY_HOME_AUTO_CONNECT_PROGRESS,
      () => null
    )
    const progressed = advanceHomeAutoConnectProgress(candidates, started, (id) =>
      id === 'a' ? 'connected' : 'connecting'
    )
    const next = advanceHomeAutoConnectProgress(
      ['a', 'c', 'd', 'e'],
      progressed,
      () => 'connecting'
    )
    expect(next.started).toEqual(['a', 'c', 'd', 'e'])
    expect(next.pending).toEqual(['c', 'd', 'e'])
    expect(next.failed).toEqual([])
  })

  it('demotes stale retries and restores a failed host when it becomes recent', () => {
    const candidates = ['a', 'b', 'c', 'd']
    const started = advanceHomeAutoConnectProgress(
      candidates,
      EMPTY_HOME_AUTO_CONNECT_PROGRESS,
      () => null
    )
    const retrying = advanceHomeAutoConnectProgress(candidates, started, (id) =>
      id === 'a' ? 'reconnecting' : 'connecting'
    )
    const demoted = advanceHomeAutoConnectProgress(['d', 'b', 'c', 'a'], retrying, (id) =>
      id === 'a' ? 'reconnecting' : 'connecting'
    )
    expect(demoted.failed).toEqual(['a'])
    expect(demoted.retrying).toEqual([])
    const promoted = advanceHomeAutoConnectProgress(
      ['a', 'd', 'b', 'c'],
      demoted,
      () => 'connecting'
    )
    expect(promoted.failed).toEqual([])
    expect(promoted.retrying).toEqual(['a'])
  })

  it('only presents hosts in the startup subset as connecting before clients open', () => {
    const autoConnectHostIds = ['recent']

    expect(resolveHomeHostConnectionState('recent', undefined, autoConnectHostIds)).toBe(
      'connecting'
    )
    expect(resolveHomeHostConnectionState('stale', undefined, autoConnectHostIds)).toBe(
      'disconnected'
    )
    expect(resolveHomeHostConnectionState('stale', 'connected', autoConnectHostIds)).toBe(
      'connected'
    )
  })
})
