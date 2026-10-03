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

vi.mock('./product/product-external-service-endpoints', () => ({
  getProductExternalServiceEndpoints: () => ({
    feedback: null,
    pluginKillList: null,
    changelog: 'https://onorca.dev/whats-new/changelog.json',
    nudge: null
  })
}))

import { fetchChangelog } from './updater-changelog'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body))
  } as unknown as Response
}

function makeEntries(
  items: {
    version: string
    title?: string
    description?: string
    mediaUrl?: string
    releaseNotesUrl?: string
  }[]
) {
  return items.map((item) => ({
    version: item.version,
    title: item.title ?? `Release ${item.version}`,
    description: item.description ?? '',
    mediaUrl: item.mediaUrl,
    releaseNotesUrl: item.releaseNotesUrl ?? `https://onorca.dev/changelog/${item.version}`
  }))
}

describe('fetchChangelog', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    defaultNetFetchMock.mockReset()
    defaultNetFetchMock.mockImplementation((...args: unknown[]) => fetchMock(...args))
    fromPartitionMock.mockReset()
    fromPartitionMock.mockReturnValue({ fetch: fetchMock })
  })

  it('uses the isolated electron-updater session instead of default net.fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))

    await expect(fetchChangelog('1.1.21', '1.1.19')).resolves.toBeNull()

    expect(fromPartitionMock).toHaveBeenCalledWith('electron-updater', { cache: false })
    expect(defaultNetFetchMock).not.toHaveBeenCalled()
  })

  it('returns exact match when the incoming version has rich content', async () => {
    const entries = makeEntries([
      {
        version: '1.1.21',
        description: 'New feature',
        mediaUrl: 'https://onorca.dev/media/1.1.21.gif'
      },
      { version: '1.1.20' },
      { version: '1.1.19' }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.21', '1.1.19')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://onorca.dev/whats-new/changelog.json',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
    )
    expect(result).not.toBeNull()
    expect(result!.release.title).toBe('Release 1.1.21')
    expect(result!.release.releaseNotesUrl).toBe('https://onorca.dev/changelog/1.1.21')
    expect(result!.release.mediaUrl).toBeUndefined()
    expect(result!.releasesBehind).toBe(2)
  })

  it('falls back to the most recent rich entry when incoming version is not in JSON', async () => {
    // Incoming 1.1.21 is not in JSON; 1.1.17 has rich content.
    // User is on 1.1.15 which is behind 1.1.17.
    const entries = makeEntries([
      {
        version: '1.1.17',
        description: 'Cool feature',
        mediaUrl: 'https://onorca.dev/media/1.1.17.gif',
        releaseNotesUrl: 'https://onorca.dev/changelog/1.1.17'
      },
      { version: '1.1.16' },
      { version: '1.1.15' }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.21', '1.1.15')

    expect(result).not.toBeNull()
    expect(result!.release.title).toBe('Release 1.1.17')
    expect(result!.release.description).toBe('Cool feature')
    expect(result!.release.releaseNotesUrl).toBe('https://onorca.dev/changelog/1.1.17')
    expect(result!.releasesBehind).toBe(2)
  })

  it('falls back when incoming version is in JSON but has no rich content', async () => {
    // Incoming 1.1.21 exists but has empty description and no media.
    // 1.1.17 has rich content.
    const entries = makeEntries([
      { version: '1.1.21', description: '', mediaUrl: undefined },
      {
        version: '1.1.17',
        description: 'Great update',
        mediaUrl: 'https://onorca.dev/media/1.1.17.gif'
      },
      { version: '1.1.15' }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.21', '1.1.15')

    expect(result).not.toBeNull()
    expect(result!.release.title).toBe('Release 1.1.17')
    expect(result!.release.releaseNotesUrl).toBe('https://onorca.dev/changelog/1.1.17')
    // releasesBehind is from local (index 2) to incoming (index 0) = 2
    expect(result!.releasesBehind).toBe(2)
  })

  it('returns null when no entry has rich content', async () => {
    const entries = makeEntries([
      { version: '1.1.21', description: '' },
      { version: '1.1.20', description: '' },
      { version: '1.1.19', description: '' }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.21', '1.1.19')

    expect(result).toBeNull()
  })

  it('treats description-only entries (no media) as non-rich', async () => {
    // Exact match has a description but no mediaUrl — should not count as rich.
    const entries = makeEntries([
      { version: '1.1.21', description: 'Bug fixes and improvements' },
      { version: '1.1.20', description: 'Minor tweaks' },
      { version: '1.1.19' }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.21', '1.1.19')

    expect(result).toBeNull()
  })

  it('skips rich entries that the user has already passed', async () => {
    // User is on 1.1.18, which is ahead of the only rich entry (1.1.17).
    const entries = makeEntries([
      { version: '1.1.20', description: '' },
      { version: '1.1.18' },
      {
        version: '1.1.17',
        description: 'Old feature',
        mediaUrl: 'https://onorca.dev/media/old.gif'
      }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.20', '1.1.18')

    // 1.1.18 is at index 1, 1.1.17 is at index 2 — user is already past it.
    expect(result).toBeNull()
  })

  it('shows rich entry at the same version as localVersion', async () => {
    // User is on 1.1.18 which has rich content; incoming 1.1.20 has none.
    // The user may not have seen the rich card for 1.1.18 (e.g., they updated
    // silently), so showing it is better than showing nothing.
    const entries = makeEntries([
      { version: '1.1.20', description: '' },
      {
        version: '1.1.18',
        description: 'Current feature',
        mediaUrl: 'https://onorca.dev/media/current.gif'
      },
      { version: '1.1.17' }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.20', '1.1.18')

    expect(result).not.toBeNull()
    expect(result!.release.title).toBe('Release 1.1.18')
    expect(result!.release.releaseNotesUrl).toBe('https://onorca.dev/changelog/1.1.18')
  })

  it('shows rich entry when local version is not in JSON (very old user)', async () => {
    const entries = makeEntries([
      { version: '1.1.20', description: '' },
      {
        version: '1.1.17',
        description: 'Feature demo',
        mediaUrl: 'https://onorca.dev/media/demo.gif'
      }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.21', '1.0.0')

    expect(result).not.toBeNull()
    expect(result!.release.title).toBe('Release 1.1.17')
    expect(result!.release.releaseNotesUrl).toBe('https://onorca.dev/changelog/1.1.17')
    // releasesBehind is null because the local version isn't in the JSON.
    expect(result!.releasesBehind).toBeNull()
  })

  it('skips rich entries when local version is newer than all changelog entries', async () => {
    // Local version 1.1.25 is not in the JSON and is newer than the latest
    // changelog entry (1.1.20). The rich entry at 1.1.17 is stale — the user
    // has already passed it.
    const entries = makeEntries([
      { version: '1.1.20', description: '' },
      {
        version: '1.1.17',
        description: 'Old feature',
        mediaUrl: 'https://onorca.dev/media/old.gif'
      }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.26', '1.1.25')

    expect(result).toBeNull()
  })

  it('returns null on non-ok HTTP response', async () => {
    const cancel = vi.fn(() => Promise.resolve())
    fetchMock.mockResolvedValue({ ok: false, body: { cancel } })

    const result = await fetchChangelog('1.1.21', '1.1.19')

    expect(result).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('returns null on non-array JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ bad: true }))

    const result = await fetchChangelog('1.1.21', '1.1.19')

    expect(result).toBeNull()
  })

  it('rejects an oversized changelog response before reading its body', async () => {
    const json = vi.fn(() => Promise.resolve([]))
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name === 'content-length' ? '1048577' : null) },
      json
    })

    await expect(fetchChangelog('1.1.21', '1.1.20')).resolves.toBeNull()
    expect(json).not.toHaveBeenCalled()
  })

  it('rejects a changelog response with an oversized entry list', async () => {
    const entries = Array.from({ length: 101 }, (_, index) => ({
      version: `1.1.${101 - index}`,
      title: `Release ${index}`,
      description: 'Rich content',
      mediaUrl: `https://onorca.dev/media/${index}.gif`,
      releaseNotesUrl: `https://onorca.dev/changelog/${index}`
    }))
    fetchMock.mockResolvedValue(jsonResponse(entries))

    await expect(fetchChangelog('1.1.101', '1.1.1')).resolves.toBeNull()
  })

  it.each([
    {
      mediaUrl: 'https://evil.example.test/media.gif',
      releaseNotesUrl: 'https://onorca.dev/changelog/1.1.21'
    },
    {
      mediaUrl: '//evil.example.test/media.gif',
      releaseNotesUrl: 'https://onorca.dev/changelog/1.1.21'
    },
    {
      mediaUrl: 'http://onorca.dev/media.gif',
      releaseNotesUrl: 'https://onorca.dev/changelog/1.1.21'
    },
    {
      mediaUrl: 'https://user:secret@onorca.dev/media.gif',
      releaseNotesUrl: 'https://onorca.dev/changelog/1.1.21'
    },
    {
      mediaUrl: 'https://onorca.dev/media.gif',
      releaseNotesUrl: 'https://evil.example.test/changelog/1.1.21'
    },
    {
      mediaUrl: 'https://onorca.dev/media.gif',
      releaseNotesUrl: 'http://onorca.dev/changelog/1.1.21'
    }
  ])(
    'rejects changelog payload URLs outside the configured product origin: %#',
    async ({ mediaUrl, releaseNotesUrl }) => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          makeEntries([
            {
              version: '1.1.21',
              description: 'Untrusted URL payload',
              mediaUrl,
              releaseNotesUrl
            }
          ])
        )
      )

      await expect(fetchChangelog('1.1.21', '1.1.20')).resolves.toBeNull()
    }
  )

  it('prefers exact match over fallback when both have rich content', async () => {
    const entries = makeEntries([
      {
        version: '1.1.21',
        description: 'Latest feature',
        mediaUrl: 'https://onorca.dev/media/latest.gif'
      },
      {
        version: '1.1.17',
        description: 'Older feature',
        mediaUrl: 'https://onorca.dev/media/old.gif'
      },
      { version: '1.1.15' }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.21', '1.1.15')

    expect(result!.release.title).toBe('Release 1.1.21')
    // Exact match keeps its own releaseNotesUrl.
    expect(result!.release.releaseNotesUrl).toBe('https://onorca.dev/changelog/1.1.21')
  })

  it('strips version from the returned release object', async () => {
    const entries = makeEntries([
      { version: '1.1.17', description: 'Feature', mediaUrl: 'https://onorca.dev/media/demo.gif' },
      { version: '1.1.15' }
    ])
    fetchMock.mockResolvedValue(jsonResponse(entries))

    const result = await fetchChangelog('1.1.21', '1.1.15')

    expect(result).not.toBeNull()
    expect('version' in result!.release).toBe(false)
  })
})
