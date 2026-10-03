import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const { describeRateLimitReset, listReleaseBuilds, rateLimitResetAtMs, resolveTargetBuild } =
  await import('./updater-release-builds')

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    text: () => Promise.resolve(JSON.stringify(body))
  }
}

/** Every platform's manifest by default, so a case that is not about asset
 *  filtering stays readable and stays green whatever platform is passed. */
const allPlatformAssets = [
  { name: 'latest-mac.yml' },
  { name: 'orca-macos-arm64.dmg' },
  { name: 'latest.yml' },
  { name: 'orca-windows-setup.exe' },
  { name: 'latest-linux.yml' },
  { name: 'orca-linux.AppImage' }
]

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  published_at: '2026-07-28T14:00:00Z',
  html_url: `https://github.com/stablyai/orca/releases/tag/${tag}`,
  assets: allPlatformAssets,
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

  afterEach(() => {
    vi.restoreAllMocks()
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

    await expect(
      listReleaseBuilds('stable', 'darwin').then((b) => b.map((x) => x.version))
    ).resolves.toEqual(['1.4.159', '1.4.158'])

    fetchMock.mockResolvedValue(
      jsonResponse([release('v1.4.160-rc.2'), release('v1.4.159'), release('v1.4.158')])
    )
    await expect(
      listReleaseBuilds('rc', 'darwin').then((b) => b.map((x) => x.version))
    ).resolves.toEqual(['1.4.160-rc.2'])
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

    const builds = await listReleaseBuilds('stable', 'darwin')
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

  // Why: a release can publish one platform before another. The picker must not
  // offer a row whose current platform download would 404.
  it('hides builds that published no artifact for this platform', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        release('v1.4.163'),
        release('v1.4.162', {
          assets: [{ name: 'latest-mac.yml' }, { name: 'orca-macos-arm64.dmg' }]
        })
      ])
    )

    await expect(
      listReleaseBuilds('stable', 'win32').then((builds) => builds.map((build) => build.version))
    ).resolves.toEqual(['1.4.163'])
  })

  it('returns an empty list when no build has this platform artifact', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([release('v1.4.163', { assets: [{ name: 'latest-mac.yml' }] })])
    )

    await expect(listReleaseBuilds('stable', 'win32')).resolves.toEqual([])
  })

  it('keeps mac builds visible on macOS regardless of the Windows leg', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([release('v1.4.163', { assets: [{ name: 'latest-mac.yml' }] })])
    )

    await expect(
      listReleaseBuilds('stable', 'darwin').then((builds) => builds.map((build) => build.version))
    ).resolves.toEqual(['1.4.163'])
  })

  it('resolves the platform installer download url', async () => {
    fetchMock.mockResolvedValue(jsonResponse([release('v1.4.163')]))

    const [build] = await listReleaseBuilds('stable', 'win32')

    expect(build.installerUrl).toBe(
      'https://github.com/stablyai/orca/releases/download/v1.4.163/orca-windows-setup.exe'
    )
  })

  it('leaves the installer url null when the release published no installer', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([release('v1.4.163', { assets: [{ name: 'latest.yml' }] })])
    )

    const [build] = await listReleaseBuilds('stable', 'win32')

    expect(build.installerUrl).toBeNull()
  })

  it('tolerates a release whose assets are missing or malformed', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        release('v1.4.163', { assets: undefined }),
        release('v1.4.162', { assets: [null, { name: 7 }] })
      ])
    )

    await expect(listReleaseBuilds('stable', 'win32')).resolves.toEqual([])
  })

  it('uses the configured product updater session without a personal auth token', async () => {
    fetchMock.mockResolvedValue(jsonResponse([release('v1.4.159')]))
    await listReleaseBuilds('stable', 'darwin')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Accept: 'application/vnd.github+json'
    })
    expect(defaultNetFetchMock).not.toHaveBeenCalled()
  })

  it('reports a secondary limit without retrying before Retry-After', async () => {
    const nowMs = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(nowMs)
    fetchMock.mockResolvedValue(
      jsonResponse(null, {
        ok: false,
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(nowMs / 1000 + 60 * 60),
          'retry-after': '60'
        }
      })
    )
    await expect(listReleaseBuilds('stable', 'darwin')).rejects.toThrow(
      'GitHub rate limit reached. Try again in about a minute.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rate limit with its reset time', async () => {
    const nowMs = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(nowMs)
    fetchMock.mockResolvedValue(
      jsonResponse(null, {
        ok: false,
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(nowMs / 1000 + 28 * 60)
        }
      })
    )

    await expect(listReleaseBuilds('stable', 'darwin')).rejects.toThrow(
      'GitHub rate limit reached. Try again in about 28 minutes.'
    )
  })

  it('treats 429 as a rate limit', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(null, { ok: false, status: 429, headers: { 'retry-after': '90' } })
    )

    await expect(listReleaseBuilds('stable', 'darwin')).rejects.toThrow(/in about 2 minutes/)
  })

  // Why: a 403 without rate-limit headers is a permission or access problem, and
  // telling the user to wait would send them waiting for a reset that never comes.
  it('reports a 403 without rate-limit headers as a plain HTTP error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { ok: false, status: 403 }))
    const failure = listReleaseBuilds('stable', 'darwin')
    await expect(failure).rejects.toThrow(/HTTP 403/)
    await expect(failure).rejects.not.toThrow(/rate limit/)
  })

  it('reports a missing configured releases repository distinctly', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null, { ok: false, status: 404 }))
    await expect(listReleaseBuilds('stable')).rejects.toThrow(/No releases repository/i)
  })
})

describe('rateLimitResetAtMs', () => {
  const nowMs = 1_800_000_000_000

  it('is null when GitHub sent no reset', () => {
    expect(rateLimitResetAtMs(new Headers(), nowMs)).toBeNull()
  })

  // Why: a secondary limit sends both, and only Retry-After is the wait GitHub asked
  // for — quoting the hour-out primary window would tell the user to wait far too long.
  it('prefers retry-after over the primary reset epoch', () => {
    const headers = new Headers({
      'x-ratelimit-reset': String(nowMs / 1000 + 10 * 60),
      'retry-after': '30'
    })
    expect(rateLimitResetAtMs(headers, nowMs)).toBe(nowMs + 30_000)
  })

  it('falls back to the primary reset epoch when there is no retry-after', () => {
    const headers = new Headers({ 'x-ratelimit-reset': String(nowMs / 1000 + 10 * 60) })
    expect(rateLimitResetAtMs(headers, nowMs)).toBe(nowMs + 10 * 60_000)
  })

  it('reads retry-after as seconds', () => {
    expect(rateLimitResetAtMs(new Headers({ 'retry-after': '90' }), nowMs)).toBe(nowMs + 90_000)
  })

  // Why: secondary limits may send Retry-After as an HTTP date (RFC 9110).
  it('reads retry-after as an HTTP date', () => {
    const headers = new Headers({ 'retry-after': new Date(nowMs + 5 * 60_000).toUTCString() })
    expect(rateLimitResetAtMs(headers, nowMs)).toBe(nowMs + 5 * 60_000)
  })
})

describe('describeRateLimitReset', () => {
  const nowMs = 1_800_000_000_000

  it('falls back to a vague wait when the reset is unknown', () => {
    expect(describeRateLimitReset(null, nowMs)).toBe('in a few minutes')
  })

  it('rounds a sub-minute reset up to a minute', () => {
    expect(describeRateLimitReset(nowMs + 20_000, nowMs)).toBe('in about a minute')
  })

  it('rounds a partial minute up', () => {
    expect(describeRateLimitReset(nowMs + 9 * 60_000 + 1, nowMs)).toBe('in about 10 minutes')
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
