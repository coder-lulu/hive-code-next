import type { RequestOptions } from 'node:http'
import { CancellationError, HttpExecutor } from 'builder-util-runtime'
import { describe, expect, it, vi } from 'vitest'
import {
  installProductUpdaterNetworkBoundary,
  installProductUpdaterHttpExecutorBoundary,
  type ProductUpdaterHttpExecutor
} from './product-updater-network-boundary'

const { onBeforeRequestMock, onHeadersReceivedMock } = vi.hoisted(() => ({
  onBeforeRequestMock: vi.fn(),
  onHeadersReceivedMock: vi.fn()
}))
vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({
      webRequest: {
        onBeforeRequest: onBeforeRequestMock,
        onHeadersReceived: onHeadersReceivedMock
      }
    })
  }
}))
const productRepository = 'coder-lulu/hive-code'

function createExecutor(getFeed: () => string) {
  const originalDoDownload = vi.fn()
  const executor: ProductUpdaterHttpExecutor = {
    request: vi.fn(),
    doApiRequest: vi.fn(),
    doDownload: originalDoDownload,
    addRedirectHandlers(request, options, _reject, _count, handler) {
      const emitter = request as {
        on: (event: string, callback: (status: number, method: string, url: string) => void) => void
      }
      emitter.on('redirect', (_status, _method, url) =>
        handler(HttpExecutor.prepareRedirectUrlOptions(url, options))
      )
    }
  }
  installProductUpdaterHttpExecutorBoundary(
    executor,
    productRepository,
    () => 'release',
    () => null,
    getFeed
  )
  return { executor, originalDoDownload }
}
function followElectronArtifactRedirect(
  executor: ProductUpdaterHttpExecutor,
  options: RequestOptions,
  url: string
) {
  let next = options
  executor.addRedirectHandlers(
    {
      on(_event: string, callback: (status: number, method: string, target: string) => void) {
        callback(302, 'GET', url)
      }
    },
    options,
    (error) => {
      throw error
    },
    0,
    (redirected) => {
      next = redirected
    }
  )
  return next
}
describe('CDN authorization lifecycle and error privacy', () => {
  it('expires and bounds CDN grants and clears them across authority epochs', () => {
    const feed = 'https://updates.hivekernel.example/hive/v1/updates/desktop/stable/windows/x64/'
    const { executor } = createExecutor(() => feed)
    let epoch = 1
    installProductUpdaterNetworkBoundary(
      productRepository,
      () => 'release',
      executor,
      () => null,
      () => [],
      () => feed,
      () => epoch
    )
    const check = onBeforeRequestMock.mock.calls.at(-1)![1]
    const callback = vi.fn()
    const source = {
      protocol: 'https:',
      hostname: 'updates.hivekernel.example',
      path: '/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download'
    }
    const now = Date.now()
    const urls = Array.from(
      { length: 129 },
      (_, i) =>
        `https://oss.cloud.hivekernel.com/releases/${i}.exe?e=${Math.floor(now / 1000) + 600}&token=test:signature`
    )
    for (const url of urls) {
      followElectronArtifactRedirect(executor, source, url)
    }
    check({ url: urls[0] }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })
    check({ url: urls[128] }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })
    const time = vi.spyOn(Date, 'now').mockReturnValue(now + 601_000)
    try {
      onHeadersReceivedMock.mock.calls.at(-1)![1](
        { url: urls[128], statusCode: 200, responseHeaders: { 'content-length': ['123'] } },
        callback
      )
      expect(callback).toHaveBeenLastCalledWith({ cancel: true })
      check({ url: urls[128] }, callback)
      expect(callback).toHaveBeenLastCalledWith({ cancel: true })
    } finally {
      time.mockRestore()
    }
    const current = urls[127]
    followElectronArtifactRedirect(executor, source, current)
    epoch = 2
    check({ url: current }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })
    epoch = 1
    check({ url: current }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })
  })

  it('does not expose signed CDN credentials through download failures', () => {
    const feed = 'https://updates.hivekernel.example/hive/v1/updates/desktop/stable/windows/x64/'
    const { executor, originalDoDownload } = createExecutor(() => feed)
    const url = `https://oss.cloud.hivekernel.com/releases/Setup.exe?e=${Math.floor(Date.now() / 1000) + 600}&token=test:privateSignature`
    const next = followElectronArtifactRedirect(
      executor,
      {
        protocol: 'https:',
        hostname: 'updates.hivekernel.example',
        path: '/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download'
      },
      url
    )
    const callback = vi.fn()
    originalDoDownload.mockImplementation((_request, options) =>
      options.callback(new Error(`Cannot download "${url}", status 503: unavailable`))
    )
    executor.doDownload(next, { callback }, 1)
    expect(callback.mock.calls[0][0].message).toBe('HiveCloud CDN download failed (HTTP 503)')
    expect(String(callback.mock.calls[0][0].stack)).not.toContain('privateSignature')
    expect(callback.mock.calls[0][0].cause).toBeUndefined()
    callback.mockClear()
    originalDoDownload.mockImplementation(() => {
      throw new Error(url)
    })
    executor.doDownload(next, { callback }, 1)
    expect(callback.mock.calls[0][0].message).toBe('HiveCloud CDN download failed')
    callback.mockClear()
    originalDoDownload.mockImplementation((_request, options) =>
      options.callback(new CancellationError())
    )
    executor.doDownload(next, { callback }, 1)
    expect(callback.mock.calls[0][0]).toBeInstanceOf(CancellationError)
  })
})
