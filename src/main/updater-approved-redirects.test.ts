import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromPartitionMock, netFetchMock, sessionFetchMock } = vi.hoisted(() => ({
  fromPartitionMock: vi.fn(),
  netFetchMock: vi.fn(),
  sessionFetchMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock },
  session: { fromPartition: fromPartitionMock }
}))

import { fetchReleaseResourceWithApprovedRedirects } from './updater-approved-redirects'

function redirectResponse(location: string) {
  const cancel = vi.fn(() => Promise.resolve())
  return {
    response: {
      status: 302,
      headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
      body: { cancel }
    } as unknown as Response,
    cancel
  }
}

describe('fetchReleaseResourceWithApprovedRedirects', () => {
  beforeEach(() => {
    netFetchMock.mockReset()
    sessionFetchMock.mockReset()
    fromPartitionMock.mockReset()
    fromPartitionMock.mockReturnValue({ fetch: sessionFetchMock })
  })

  it('cancels an intermediate redirect response before following its location', async () => {
    const redirect = redirectResponse(
      'https://release-assets.githubusercontent.com/github-production-release-asset/123/file.zip'
    )
    const finalResponse = { status: 200 } as Response
    netFetchMock.mockResolvedValueOnce(redirect.response).mockResolvedValueOnce(finalResponse)
    sessionFetchMock.mockResolvedValueOnce(redirect.response).mockResolvedValueOnce(finalResponse)

    await expect(
      fetchReleaseResourceWithApprovedRedirects(
        'https://github.com/coder-lulu/hive-code/releases/download/v1.0.0/file.zip',
        { method: 'HEAD' }
      )
    ).resolves.toBe(finalResponse)

    expect(redirect.cancel).toHaveBeenCalledTimes(1)
    expect(fromPartitionMock).toHaveBeenCalledWith('electron-updater', { cache: false })
    expect(netFetchMock).not.toHaveBeenCalled()
  })
})
