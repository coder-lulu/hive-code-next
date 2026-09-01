import { readFileSync } from 'node:fs'
import type { RequestOptions } from 'node:http'
import { createRequire } from 'node:module'
import { HttpExecutor } from 'builder-util-runtime'
import { describe, expect, it, vi } from 'vitest'
import {
  installProductUpdaterHttpExecutorBoundary,
  installProductUpdaterNetworkBoundary,
  isAllowedProductUpdaterRequest,
  isBoundedUpdaterArtifactSize
} from './product-updater-network-boundary'

const { fromPartitionMock, onBeforeRequestMock, onHeadersReceivedMock, sessionFetchMock } =
  vi.hoisted(() => {
    const onBeforeRequestMock = vi.fn()
    const onHeadersReceivedMock = vi.fn()
    const sessionFetchMock = vi.fn()
    return {
      fromPartitionMock: vi.fn(() => ({
        fetch: sessionFetchMock,
        webRequest: {
          onBeforeRequest: onBeforeRequestMock,
          onHeadersReceived: onHeadersReceivedMock
        }
      })),
      onBeforeRequestMock,
      onHeadersReceivedMock,
      sessionFetchMock
    }
  })

vi.mock('electron', () => ({
  session: { fromPartition: fromPartitionMock }
}))

const productRepository = 'coder-lulu/hive-code'
const require = createRequire(import.meta.url)

describe('isBoundedUpdaterArtifactSize', () => {
  it('uses the same 2 GiB limit for local and network artifacts', () => {
    expect(isBoundedUpdaterArtifactSize(2 * 1024 * 1024 * 1024)).toBe(true)
    expect(isBoundedUpdaterArtifactSize(2 * 1024 * 1024 * 1024 + 1)).toBe(false)
  })
})

describe('isAllowedProductUpdaterRequest', () => {
  it.each([
    'https://github.com/coder-lulu/hive-code/releases.atom',
    'https://api.github.com/repos/coder-lulu/hive-code/releases?per_page=100',
    'https://github.com/coder-lulu/hive-code/releases/latest/download/latest-mac.yml',
    'https://github.com/coder-lulu/hive-code/releases/latest/download/latest-mac.yml?noCache=1j4abc',
    'https://github.com/coder-lulu/hive-code/releases/download/v1.0.0/Product.zip'
  ])('allows an approved release updater request: %s', (url) => {
    expect(isAllowedProductUpdaterRequest(url, productRepository, 'release')).toBe(true)
  })

  it.each([
    'http://127.0.0.1:49152/token/latest-mac.yml',
    'http://127.0.0.1:49152/token/Product.zip'
  ])('allows an approved local updater request: %s', (url) => {
    expect(
      isAllowedProductUpdaterRequest(url, null, 'local', 'http://127.0.0.1:49152/token/')
    ).toBe(true)
  })

  it.each([
    'http://127.0.0.1:49153/token/latest-mac.yml',
    'http://127.0.0.1:49152/other/latest-mac.yml',
    'http://127.0.0.1:49152/token-escape/latest-mac.yml'
  ])('rejects a local updater request outside the active feed capability: %s', (url) => {
    expect(
      isAllowedProductUpdaterRequest(url, null, 'local', 'http://127.0.0.1:49152/token/')
    ).toBe(false)
  })

  it.each([
    'https://evil.example.test/payload.zip',
    'https://github.com/stablyai/orca/releases/latest/download/latest-mac.yml',
    'https://github.com/coder-lulu/hive-code-other/releases/download/v1/file.zip',
    'https://github.com:444/coder-lulu/hive-code/releases/download/v1/file.zip',
    'https://github.com/coder-lulu/hive-code/releases/%64ownload/v1/file.zip',
    'https://github.com/coder-lulu/hive-code/releases/latest/download/latest-mac.yml?token=secret',
    'https://github.com/coder-lulu/hive-code/releases/latest/download/latest-mac.yml?noCache=1j4abc&extra=1',
    'https://github.com/coder-lulu/hive-code/releases/latest/download/latest-mac.yml?noCache=',
    'https://user:secret@release-assets.githubusercontent.com/file.zip',
    'https://release-assets.githubusercontent.com:444/file.zip',
    'https://release-assets.githubusercontent.com/github-production-release-asset/123/file.zip?sig=test',
    'https://objects.githubusercontent.com/github-production-release-asset/file.zip?sig=test',
    'http://localhost:49152/latest-mac.yml',
    'http://192.168.1.10:49152/latest-mac.yml'
  ])('blocks an updater request outside the product boundary: %s', (url) => {
    expect(isAllowedProductUpdaterRequest(url, productRepository, 'release')).toBe(false)
  })

  it('does not merge release and local permissions', () => {
    expect(
      isAllowedProductUpdaterRequest(
        'http://127.0.0.1:49152/latest-mac.yml',
        productRepository,
        'release'
      )
    ).toBe(false)
    expect(
      isAllowedProductUpdaterRequest(
        'https://github.com/coder-lulu/hive-code/releases/download/v1.0.0/Product.zip',
        productRepository,
        'local'
      )
    ).toBe(false)
    expect(
      isAllowedProductUpdaterRequest(
        'https://release-assets.githubusercontent.com/github-production-release-asset/file.zip',
        productRepository,
        'local'
      )
    ).toBe(false)
  })

  it('allows only explicitly configured external updater control URLs', () => {
    const configured = 'https://updates.hivekernel.com/whats-new/changelog.json'
    expect(
      isAllowedProductUpdaterRequest(configured, productRepository, 'release', null, [configured])
    ).toBe(true)
    expect(
      isAllowedProductUpdaterRequest(
        'https://updates.hivekernel.com/whats-new/other.json',
        productRepository,
        'release',
        null,
        [configured]
      )
    ).toBe(false)
  })

  it('allows the HiveCloud check query appended to its configured control endpoint', () => {
    const configured = 'https://updates.hivekernel.com/hive/v1/updates/check'
    const queried = `${configured}?product=hivecode&platform=windows&architecture=x64&channel=beta&currentVersion=1.4.178-rc.7&currentBuild=1`
    expect(isAllowedProductUpdaterRequest(queried, null, 'release', null, [configured])).toBe(true)
    expect(
      isAllowedProductUpdaterRequest(
        'https://updates.hivekernel.com/hive/v1/updates/check/other?product=hivecode',
        null,
        'release',
        null,
        [configured]
      )
    ).toBe(false)
    expect(
      isAllowedProductUpdaterRequest(
        `${configured}?product=hivecode&platform=windows&architecture=x64&channel=beta&currentVersion=1.4.178-rc.7&currentBuild=1&token=secret`,
        null,
        'release',
        null,
        [configured]
      )
    ).toBe(false)
    expect(
      isAllowedProductUpdaterRequest(
        `${configured}?product=hivecode&product=other&platform=windows&architecture=x64&channel=beta&currentVersion=1.4.178-rc.7&currentBuild=1`,
        null,
        'release',
        null,
        [configured]
      )
    ).toBe(false)
  })
})

describe('installProductUpdaterNetworkBoundary', () => {
  it('pins electron-updater to the audited version', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as { dependencies?: Record<string, string> }

    expect(packageJson.dependencies?.['electron-updater']).toBe('6.8.9')
  })

  it('matches the partition currently used by electron-updater', () => {
    const executorSource = readFileSync(
      require.resolve('electron-updater/out/electronHttpExecutor'),
      'utf8'
    )

    expect(executorSource).toContain('exports.NET_SESSION_NAME = "electron-updater"')
    expect(executorSource).toContain('session.fromPartition(exports.NET_SESSION_NAME')
    expect(executorSource).toContain('cache: false')
  })

  it('accepts the exact cache-busting query generated by GenericProvider', () => {
    const { newUrlFromBase } = require('electron-updater/out/util') as {
      newUrlFromBase: (pathname: string, baseUrl: URL, addNoCache: boolean) => URL
    }
    const generatedUrl = newUrlFromBase(
      'latest-mac.yml',
      new URL('https://github.com/coder-lulu/hive-code/releases/latest/download/'),
      true
    )

    expect([...generatedUrl.searchParams.keys()]).toEqual(['noCache'])
    expect(isAllowedProductUpdaterRequest(generatedUrl.href, productRepository, 'release')).toBe(
      true
    )
  })

  it('installs a fail-closed request filter on the electron-updater partition', () => {
    let mode: 'release' | 'local' = 'release'
    let localFeedUrl: string | null = null
    installProductUpdaterNetworkBoundary(
      productRepository,
      () => mode,
      undefined,
      () => localFeedUrl,
      () => ['https://updates.hivekernel.com/whats-new/changelog.json']
    )

    expect(fromPartitionMock).toHaveBeenCalledWith('electron-updater', { cache: false })
    expect(onBeforeRequestMock).toHaveBeenCalledWith({ urls: ['<all_urls>'] }, expect.any(Function))
    expect(onHeadersReceivedMock).toHaveBeenCalledWith(
      { urls: ['<all_urls>'] },
      expect.any(Function)
    )

    const handler = onBeforeRequestMock.mock.calls[0][1] as (
      details: { url: string },
      callback: (response: { cancel: boolean }) => void
    ) => void
    const callback = vi.fn()

    handler({ url: 'https://evil.example.test/payload.zip' }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })

    handler({ url: 'https://updates.hivekernel.com/whats-new/changelog.json' }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })

    handler(
      {
        url: 'https://github.com/coder-lulu/hive-code/releases/download/v1.0.0/Product.zip'
      },
      callback
    )
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })

    handler({ url: 'http://127.0.0.1:49152/token/latest-mac.yml' }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })

    mode = 'local'
    localFeedUrl = 'http://127.0.0.1:49152/token/'
    handler({ url: 'http://127.0.0.1:49152/token/latest-mac.yml' }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })

    handler(
      {
        url: 'https://github.com/coder-lulu/hive-code/releases/download/v1.0.0/Product.zip'
      },
      callback
    )
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })
  })

  it('cancels final artifact responses with missing or oversized content lengths', () => {
    installProductUpdaterNetworkBoundary(productRepository, () => 'release')
    const handler = onHeadersReceivedMock.mock.calls.at(-1)?.[1] as (
      details: { responseHeaders?: Record<string, string[]>; statusCode: number; url: string },
      callback: (response: { cancel: boolean }) => void
    ) => void
    const callback = vi.fn()
    const url = 'https://github.com/coder-lulu/hive-code/releases/download/v1.0.0/Product.zip'

    handler({ responseHeaders: {}, statusCode: 302, url }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })

    handler(
      {
        responseHeaders: { 'content-length': [String(4 * 1024 * 1024)] },
        statusCode: 206,
        url
      },
      callback
    )
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })

    handler({ responseHeaders: {}, statusCode: 200, url }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })

    handler(
      {
        responseHeaders: { 'content-length': [String(2 * 1024 * 1024 * 1024 + 1)] },
        statusCode: 200,
        url
      },
      callback
    )
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })

    handler(
      {
        responseHeaders: { 'Content-Length': [String(512 * 1024 * 1024)] },
        statusCode: 200,
        url
      },
      callback
    )
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })
  })

  it('treats a HiveCloud object-storage gateway response as the final artifact', () => {
    const feed = 'https://updates.hivekernel.example/hive/v1/updates/desktop/stable/windows/x64/'
    installProductUpdaterNetworkBoundary(
      null,
      () => 'release',
      undefined,
      () => null,
      () => [],
      () => feed
    )
    const handler = onHeadersReceivedMock.mock.calls.at(-1)?.[1] as (
      details: { responseHeaders?: Record<string, string[]>; statusCode: number; url: string },
      callback: (response: { cancel: boolean }) => void
    ) => void
    const callback = vi.fn()
    handler(
      {
        responseHeaders: { 'content-length': ['123'] },
        statusCode: 200,
        url: 'https://updates.hivekernel.example/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download'
      },
      callback
    )
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })
  })

  it('does not let the HiveCloud feed path serve arbitrary installer bytes', () => {
    const feed = 'https://updates.hivekernel.example/hive/v1/updates/desktop/stable/windows/x64/'
    installProductUpdaterNetworkBoundary(
      null,
      () => 'release',
      undefined,
      () => null,
      () => [],
      () => feed
    )
    const handler = onBeforeRequestMock.mock.calls.at(-1)?.[1] as (
      details: { url: string },
      callback: (response: { cancel: boolean }) => void
    ) => void
    const callback = vi.fn()

    handler({ url: `${feed}HiveCode.exe` }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })

    handler(
      {
        url: 'https://updates.hivekernel.example/hive/v1/update-artifacts/4f1f7c54-06f2-4a22-b4a9-26c9c9b0c3f5/download'
      },
      callback
    )
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })
  })
})

describe('installProductUpdaterHttpExecutorBoundary', () => {
  function redirectResponse(location: string) {
    return {
      status: 302,
      ok: false,
      headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
      body: { cancel: vi.fn(() => Promise.resolve()) }
    } as unknown as Response
  }

  function textResponse(body: string) {
    const bytes = new TextEncoder().encode(body)
    let consumed = false
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: vi.fn(async () => {
            if (consumed) {
              return { done: true, value: undefined }
            }
            consumed = true
            return { done: false, value: bytes }
          }),
          cancel: vi.fn(() => Promise.resolve()),
          releaseLock: vi.fn()
        })
      }
    } as unknown as Response
  }

  function createExecutor(
    getReleaseFeedUrl: () => string | null = () =>
      'https://github.com/coder-lulu/hive-code/releases/latest/download/'
  ) {
    const originalDoApiRequest = vi.fn(() => Promise.resolve('api'))
    const originalDoDownload = vi.fn()
    class TestExecutor {
      static prepareRedirectUrlOptions(
        redirectUrl: string,
        options: RequestOptions
      ): RequestOptions {
        const target = new URL(redirectUrl)
        return {
          ...options,
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`
        }
      }

      request = vi.fn(() => Promise.resolve('unbounded'))
      doApiRequest = originalDoApiRequest
      doDownload = originalDoDownload
      addRedirectHandlers(
        request: { on: (event: string, handler: (...args: unknown[]) => void) => void },
        options: RequestOptions,
        _reject: (error: Error) => void,
        _redirectCount: number,
        handler: (options: RequestOptions) => void
      ): void {
        request.on('redirect', (_statusCode, _method, redirectUrl) => {
          // Mirrors electron-updater@6.8.9 exactly: it calls the imported base class,
          // not this.constructor.prepareRedirectUrlOptions.
          handler(HttpExecutor.prepareRedirectUrlOptions(String(redirectUrl), options))
        })
      }
    }
    const executor = new TestExecutor() as unknown as Parameters<
      typeof installProductUpdaterHttpExecutorBoundary
    >[0]
    installProductUpdaterHttpExecutorBoundary(
      executor,
      productRepository,
      () => 'release',
      () => null,
      getReleaseFeedUrl
    )
    return { executor, originalDoApiRequest, originalDoDownload }
  }

  function followElectronArtifactRedirect(
    executor: ReturnType<typeof createExecutor>['executor'],
    options: RequestOptions,
    redirectUrl: string
  ): RequestOptions {
    let redirected: RequestOptions | null = null
    const fakeRequest = {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === 'redirect') {
          handler(302, 'GET', redirectUrl)
        }
      }
    }
    ;(
      executor as typeof executor & {
        addRedirectHandlers: (
          request: typeof fakeRequest,
          options: RequestOptions,
          reject: (error: Error) => void,
          redirectCount: number,
          handler: (next: RequestOptions) => void
        ) => void
      }
    ).addRedirectHandlers(fakeRequest, options, vi.fn(), 0, (next) => {
      redirected = next
    })
    if (redirected === null) {
      throw new Error('redirect handler did not produce request options')
    }
    return redirected
  }

  it('patches the live Electron redirect handler even when it calls the imported base class', () => {
    const { executor } = createExecutor()
    const options: RequestOptions = {
      protocol: 'https:',
      hostname: 'github.com',
      path: '/coder-lulu/hive-code/releases/latest/download/latest.yml',
      headers: {
        accept: 'application/octet-stream',
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        Host: 'github.com',
        'x-user-staging-id': 'secret'
      }
    }

    const redirected = followElectronArtifactRedirect(
      executor,
      options,
      'https://release-assets.githubusercontent.com/asset/latest.yml'
    )

    expect(redirected.headers).toEqual(
      expect.objectContaining({ accept: 'application/octet-stream' })
    )
    expect(redirected.headers).not.toHaveProperty('authorization')
    expect(redirected.headers).not.toHaveProperty('cookie')
    expect(redirected.headers).not.toHaveProperty('Host')
    expect(redirected.headers).not.toHaveProperty('x-user-staging-id')
  })

  it('allows at most three redirects while reading updater metadata', async () => {
    const { executor } = createExecutor()
    sessionFetchMock
      .mockReset()
      .mockResolvedValueOnce(
        redirectResponse('https://release-assets.githubusercontent.com/asset/one.yml')
      )
      .mockResolvedValueOnce(
        redirectResponse('https://objects.githubusercontent.com/asset/two.yml')
      )
      .mockResolvedValueOnce(
        redirectResponse('https://release-assets.githubusercontent.com/asset/three.yml')
      )
      .mockResolvedValueOnce(textResponse('version: 1.0.0'))

    await expect(
      executor.request({
        protocol: 'https:',
        hostname: 'github.com',
        path: '/coder-lulu/hive-code/releases/latest/download/latest.yml',
        headers: {
          accept: 'application/octet-stream',
          authorization: 'Bearer secret',
          cookie: 'session=secret',
          'x-product': 'unsafe',
          'x-user-staging-id': 'staging-secret'
        }
      })
    ).resolves.toBe('version: 1.0.0')
    const redirectedHeaders = sessionFetchMock.mock.calls[1][1].headers as Headers
    expect(redirectedHeaders.get('accept')).toBe('application/octet-stream')
    expect(redirectedHeaders.get('authorization')).toBeNull()
    expect(redirectedHeaders.get('cookie')).toBeNull()
    expect(redirectedHeaders.get('x-product')).toBeNull()
    expect(redirectedHeaders.get('x-user-staging-id')).toBeNull()

    sessionFetchMock
      .mockReset()
      .mockResolvedValueOnce(
        redirectResponse('https://release-assets.githubusercontent.com/asset/one.yml')
      )
      .mockResolvedValueOnce(
        redirectResponse('https://objects.githubusercontent.com/asset/two.yml')
      )
      .mockResolvedValueOnce(
        redirectResponse('https://release-assets.githubusercontent.com/asset/three.yml')
      )
      .mockResolvedValueOnce(
        redirectResponse('https://objects.githubusercontent.com/asset/four.yml')
      )

    await expect(
      executor.request({
        protocol: 'https:',
        hostname: 'github.com',
        path: '/coder-lulu/hive-code/releases/latest/download/latest.yml'
      })
    ).rejects.toThrow('Too many updater redirects')
    expect(sessionFetchMock).toHaveBeenCalledTimes(4)
  })

  it('rejects the real metadata response when its streamed body exceeds 256 KiB', async () => {
    const { executor } = createExecutor()
    const cancel = vi.fn(() => Promise.resolve())
    sessionFetchMock.mockReset().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => String(256 * 1024 + 1) },
      body: { cancel },
      text: vi.fn()
    } as unknown as Response)

    await expect(
      executor.request({
        protocol: 'https:',
        hostname: 'github.com',
        path: '/coder-lulu/hive-code/releases/latest/download/latest.yml'
      })
    ).rejects.toThrow('Updater metadata response exceeded')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('blocks a fourth redirect in the dependency download path', () => {
    const { executor, originalDoDownload } = createExecutor(
      () => 'https://github.com/coder-lulu/hive-code/releases/download/v1.0.0/'
    )
    const callback = vi.fn()
    const downloadOptions = { callback }
    let requestOptions: RequestOptions = {
      protocol: 'https:',
      hostname: 'github.com',
      path: '/coder-lulu/hive-code/releases/download/v1.0.0/Product.zip',
      headers: {
        accept: 'application/octet-stream',
        'x-user-staging-id': 'staging-secret'
      }
    }

    for (let redirect = 0; redirect <= 3; redirect++) {
      executor.doDownload(requestOptions, downloadOptions, 0)
      requestOptions = followElectronArtifactRedirect(
        executor,
        requestOptions,
        `https://release-assets.githubusercontent.com/asset/${redirect}.zip`
      )
      expect(requestOptions.headers).toEqual(
        expect.objectContaining({ accept: 'application/octet-stream' })
      )
      expect(requestOptions.headers).not.toHaveProperty('x-user-staging-id')
    }
    executor.doDownload(requestOptions, downloadOptions, 0)

    expect(originalDoDownload).toHaveBeenCalledTimes(4)
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Too many updater redirects' })
    )
  })

  it('binds release downloads to the active concrete feed and redirect provenance', () => {
    const activeFeed = 'https://github.com/coder-lulu/hive-code/releases/download/v1.0.0/'
    const { executor, originalDoDownload } = createExecutor(() => activeFeed)
    const callback = vi.fn()
    const downloadOptions = { callback }
    const initialOptions: RequestOptions = {
      protocol: 'https:',
      hostname: 'github.com',
      path: '/coder-lulu/hive-code/releases/download/v1.0.0/Product.zip'
    }

    executor.doDownload(initialOptions, downloadOptions, 0)
    const redirected = followElectronArtifactRedirect(
      executor,
      initialOptions,
      'https://release-assets.githubusercontent.com/github-production-release-asset/123/Product.zip'
    )
    executor.doDownload(redirected, downloadOptions, 0)

    executor.doDownload(
      {
        protocol: 'https:',
        hostname: 'release-assets.githubusercontent.com',
        path: '/github-production-release-asset/attacker/Product.zip'
      },
      downloadOptions,
      0
    )
    executor.doDownload(
      {
        protocol: 'https:',
        hostname: 'github.com',
        path: '/coder-lulu/hive-code/releases/download/v0.9.0/Product.zip'
      },
      downloadOptions,
      0
    )

    expect(originalDoDownload).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('outside the active update feed')
      })
    )
  })

  it('grants the updater partition an exact CDN capability only after an authorized redirect', () => {
    const activeFeed = 'https://github.com/coder-lulu/hive-code/releases/download/v1.0.0/'
    let authorityEpoch = 1
    const { executor } = createExecutor(() => activeFeed)
    installProductUpdaterNetworkBoundary(
      productRepository,
      () => 'release',
      executor,
      () => null,
      () => [],
      () => activeFeed,
      () => authorityEpoch
    )
    const handler = onBeforeRequestMock.mock.calls.at(-1)?.[1] as (
      details: { url: string },
      callback: (result: { cancel: boolean }) => void
    ) => void
    const callback = vi.fn()
    const cdnUrl =
      'https://release-assets.githubusercontent.com/github-production-release-asset/123/Product.zip?sig=test'

    handler({ url: cdnUrl }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })

    followElectronArtifactRedirect(
      executor,
      {
        protocol: 'https:',
        hostname: 'github.com',
        path: '/coder-lulu/hive-code/releases/download/v1.0.0/Product.zip'
      },
      cdnUrl
    )
    handler({ url: cdnUrl }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: false })

    authorityEpoch += 1
    handler({ url: cdnUrl }, callback)
    expect(callback).toHaveBeenLastCalledWith({ cancel: true })
  })
})
