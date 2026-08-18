import { beforeEach, describe, expect, it, vi } from 'vitest'

const { defaultNetFetchMock, fetchMock, fromPartitionMock } = vi.hoisted(() => ({
  defaultNetFetchMock: vi.fn(),
  fetchMock: vi.fn(),
  fromPartitionMock: vi.fn()
}))
vi.mock('electron', () => ({
  net: { fetch: defaultNetFetchMock },
  session: { fromPartition: fromPartitionMock }
}))

const updateSourceState = vi.hoisted(() => ({
  value: {
    channel: 'stable',
    feedUrl: 'https://github.com/stablyai/orca/releases/latest/download',
    github: {
      repo: 'stablyai/orca',
      atomFeedUrl: 'https://github.com/stablyai/orca/releases.atom',
      releasesDownloadBase: 'https://github.com/stablyai/orca/releases/download',
      releasesApiUrl: 'https://api.github.com/repos/stablyai/orca/releases'
    }
  } as unknown
}))

vi.mock('../shared/product-update-source', () => ({
  resolveProductUpdateSource: () => updateSourceState.value
}))

const { listReleaseBuilds, resolveTargetBuild } = await import('./updater-release-builds')

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body))
  }
}

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  published_at: '2026-07-28T14:00:00Z',
  html_url: `https://github.com/stablyai/orca/releases/tag/${tag}`,
  ...extra
})

describe('listReleaseBuilds', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    defaultNetFetchMock.mockReset()
    defaultNetFetchMock.mockImplementation((...args: unknown[]) => fetchMock(...args))
    fromPartitionMock.mockReset()
    fromPartitionMock.mockReturnValue({ fetch: fetchMock })
    updateSourceState.value = {
      channel: 'stable',
      feedUrl: 'https://github.com/stablyai/orca/releases/latest/download',
      github: {
        repo: 'stablyai/orca',
        atomFeedUrl: 'https://github.com/stablyai/orca/releases.atom',
        releasesDownloadBase: 'https://github.com/stablyai/orca/releases/download',
        releasesApiUrl: 'https://api.github.com/repos/stablyai/orca/releases'
      }
    }
  })

  it('performs no network request when the product update source is disabled', async () => {
    updateSourceState.value = null

    await expect(listReleaseBuilds('stable')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the isolated electron-updater session instead of default net.fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))

    await expect(listReleaseBuilds('stable')).resolves.toEqual([])

    expect(fromPartitionMock).toHaveBeenCalledWith('electron-updater', { cache: false })
    expect(defaultNetFetchMock).not.toHaveBeenCalled()
  })

  it('cancels an unread release API body before reporting a non-success status', async () => {
    const cancel = vi.fn(() => Promise.resolve())
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      body: { cancel }
    })

    await expect(listReleaseBuilds('stable')).rejects.toThrow('HTTP 503')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized release API body before parsing it', async () => {
    const json = vi.fn(() => Promise.resolve([]))
    const text = vi.fn(() => Promise.resolve('[]'))
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-length' ? '10000000' : null)
      },
      json,
      text
    })

    await expect(listReleaseBuilds('stable')).rejects.toThrow(/too large/i)
    expect(json).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
  })

  it('performs no network request for a channel without a configured product repository', async () => {
    updateSourceState.value = {
      channel: 'stable',
      feedUrl: 'https://github.com/coder-lulu/hive-code/releases/latest/download',
      github: {
        repo: 'coder-lulu/hive-code',
        atomFeedUrl: 'https://github.com/coder-lulu/hive-code/releases.atom',
        releasesDownloadBase: 'https://github.com/coder-lulu/hive-code/releases/download',
        releasesApiUrl: 'https://api.github.com/repos/coder-lulu/hive-code/releases'
      }
    }
    await expect(listReleaseBuilds('hourly')).resolves.toEqual([])
    await expect(listReleaseBuilds('daily')).resolves.toEqual([])
    await expect(listReleaseBuilds('adhoc')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Why: the main repo serves stable and rc from one endpoint, so an unfiltered
  // list would offer RC tags under the Stable channel.
  it('separates stable from rc in the shared main repo', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([release('v1.4.160-rc.2'), release('v1.4.159'), release('v1.4.158')])
    )

    await expect(listReleaseBuilds('stable').then((b) => b.map((x) => x.version))).resolves.toEqual(
      ['1.4.159', '1.4.158']
    )

    fetchMock.mockResolvedValue(
      jsonResponse([release('v1.4.160-rc.2'), release('v1.4.159'), release('v1.4.158')])
    )
    await expect(listReleaseBuilds('rc').then((b) => b.map((x) => x.version))).resolves.toEqual([
      '1.4.160-rc.2'
    ])
  })

  // Why: a draft release has no downloadable assets; offering it makes the
  // switch action fail with a 404 after the user commits to it.
  it('skips drafts and unparseable tags', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        release('v1.4.159'),
        release('v1.4.158', { draft: true }),
        release('not-a-version'),
        { tag_name: 42 }
      ])
    )

    const builds = await listReleaseBuilds('stable')
    expect(builds.map((build) => build.version)).toEqual(['1.4.159'])
  })

  it('derives release links from the approved repository instead of trusting API html_url', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        release('v1.4.159', {
          html_url: 'https://evil.example.test/phishing'
        })
      ])
    )

    await expect(listReleaseBuilds('stable')).resolves.toEqual([
      expect.objectContaining({
        releaseUrl: 'https://github.com/stablyai/orca/releases/tag/v1.4.159'
      })
    ])
  })

  // Why: the picker renders a release title verbatim. A title that only repeats
  // the tag says nothing the version beside it does not.
  it('keeps a composed release title and drops one that repeats the tag', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        release('v1.4.163', { name: 'Product 1.4.163' }),
        release('v1.4.162', { name: 'v1.4.162' }),
        release('v1.4.161', { name: '   ' }),
        release('v1.4.160', { name: 42 })
      ])
    )

    const builds = await listReleaseBuilds('stable')
    expect(builds.map((build) => build.name)).toEqual(['Product 1.4.163', null, null, null])
  })

  it('surfaces a rate limit as an actionable message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { ok: false, status: 403 }))
    await expect(listReleaseBuilds('stable')).rejects.toThrow(/rate limit/i)
  })

  it('reports a missing configured releases repository distinctly', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { ok: false, status: 404 }))
    await expect(listReleaseBuilds('stable')).rejects.toThrow(/No releases repository/i)
  })
})

describe('resolveTargetBuild', () => {
  it('rejects a target from an unconfigured dev channel', () => {
    expect(() => resolveTargetBuild('hourly', 'v1.4.160-hourly.202607281400')).toThrow(
      /not configured/i
    )
  })

  it('rejects a daily tag while no product daily repository is configured', () => {
    expect(() => resolveTargetBuild('daily', 'v1.4.160-daily.202607281300')).toThrow(
      /not configured/i
    )
  })

  it('pins a stable tag at the main repo download path', () => {
    expect(resolveTargetBuild('stable', 'v1.4.159').feedUrl).toBe(
      'https://github.com/stablyai/orca/releases/download/v1.4.159'
    )
  })

  it.each([
    ['stable', 'v1.4.160-rc.2'],
    ['rc', 'v1.4.159'],
    ['stable', 'v1.4.160-hourly.202607281400'],
    ['rc', 'v1.4.160-adhoc.20260728140533']
  ] as const)('rejects a %s request for the mismatched tag %s', (channel, tag) => {
    expect(() => resolveTargetBuild(channel, tag)).toThrow(/does not belong to the .* channel/i)
  })

  it('rejects a tag that is not a version', () => {
    expect(() => resolveTargetBuild('stable', 'main')).toThrow(/not a valid release tag/)
  })
})
