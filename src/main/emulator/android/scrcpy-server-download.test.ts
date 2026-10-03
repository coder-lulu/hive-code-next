import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureScrcpyServerJar, scrcpyServerJarPath } from './scrcpy-server-download'

const { appGetPathMock, netRequestMock, rawHttpsGetMock } = vi.hoisted(() => ({
  appGetPathMock: vi.fn(),
  netRequestMock: vi.fn(),
  rawHttpsGetMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: appGetPathMock },
  net: { request: netRequestMock }
}))
// Regression guard: any return to raw Node HTTPS bypasses Electron's configured proxy.
vi.mock('node:https', () => ({ get: rawHttpsGetMock }))

const DOWNLOAD_URL =
  'https://github.com/Genymobile/scrcpy/releases/download/v2.4/scrcpy-server-v2.4'
const VALID_JAR_BYTES = 10_001

type FakeRequest = EventEmitter & {
  abort: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  followRedirect: ReturnType<typeof vi.fn>
}

function createResponse(statusCode: number): PassThrough & { statusCode: number } {
  const response = new PassThrough() as PassThrough & { statusCode: number }
  response.statusCode = statusCode
  return response
}

function installRequest(onEnd: (request: FakeRequest) => void): FakeRequest {
  const request = new EventEmitter() as FakeRequest
  request.abort = vi.fn()
  request.followRedirect = vi.fn()
  request.end = vi.fn(() => onEnd(request))
  netRequestMock.mockReturnValue(request)
  return request
}

describe('scrcpy server download', () => {
  let userDataPath: string

  beforeEach(() => {
    vi.clearAllMocks()
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-scrcpy-download-'))
    appGetPathMock.mockReturnValue(userDataPath)
    rawHttpsGetMock.mockImplementation(() => {
      throw new Error('raw node:https must not be used')
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('downloads redirects through Electron net so the configured proxy is used', async () => {
    const assetUrl = 'https://release-assets.githubusercontent.com/scrcpy-server-v2.4'
    const response = createResponse(200)
    const request = installRequest((activeRequest) => {
      activeRequest.emit('redirect', 302, 'GET', assetUrl, {})
    })
    request.followRedirect.mockImplementation(() => {
      request.emit('response', response)
      response.end(Buffer.alloc(VALID_JAR_BYTES))
    })

    const path = await ensureScrcpyServerJar()

    expect(path).toBe(scrcpyServerJarPath())
    expect(readFileSync(path)).toHaveLength(VALID_JAR_BYTES)
    expect(netRequestMock).toHaveBeenCalledWith({
      method: 'GET',
      url: DOWNLOAD_URL,
      redirect: 'manual'
    })
    expect(request.followRedirect).toHaveBeenCalledOnce()
    expect(rawHttpsGetMock).not.toHaveBeenCalled()
  })

  it('reuses a valid cached jar without a network request', async () => {
    const path = scrcpyServerJarPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.alloc(VALID_JAR_BYTES))

    await expect(ensureScrcpyServerJar()).resolves.toBe(path)

    expect(netRequestMock).not.toHaveBeenCalled()
  })

  it('removes a partial file when the proxy-aware request fails', async () => {
    const response = createResponse(502)
    const request = installRequest((activeRequest) => {
      activeRequest.emit('response', response)
    })

    await expect(ensureScrcpyServerJar()).rejects.toThrow(
      'Could not download scrcpy server: HTTP 502'
    )

    expect(existsSync(scrcpyServerJarPath())).toBe(false)
    expect(request.abort).toHaveBeenCalledOnce()
    expect(response.destroyed).toBe(true)
  })

  it('aborts a download after 30 seconds without network activity', async () => {
    vi.useFakeTimers()
    const request = installRequest(() => {})

    const download = expect(ensureScrcpyServerJar()).rejects.toThrow(
      'Could not download scrcpy server: download timed out'
    )
    await vi.advanceTimersByTimeAsync(30_000)

    await download
    expect(request.abort).toHaveBeenCalledOnce()
    expect(existsSync(scrcpyServerJarPath())).toBe(false)
  })

  it('aborts a response body that stops producing data', async () => {
    vi.useFakeTimers()
    const response = createResponse(200)
    const request = installRequest((activeRequest) => {
      activeRequest.emit('response', response)
      response.write(Buffer.from([1, 2, 3]))
    })

    const download = expect(ensureScrcpyServerJar()).rejects.toThrow(
      'Could not download scrcpy server: download timed out'
    )
    await vi.advanceTimersByTimeAsync(30_000)

    await download
    expect(request.abort).toHaveBeenCalledOnce()
    expect(response.destroyed).toBe(true)
    expect(existsSync(scrcpyServerJarPath())).toBe(false)
  })

  it('removes a partial jar when the response stream fails', async () => {
    const response = createResponse(200)
    installRequest((activeRequest) => {
      activeRequest.emit('response', response)
      response.write(Buffer.from([1, 2, 3]))
      response.destroy(new Error('connection reset'))
    })

    await expect(ensureScrcpyServerJar()).rejects.toThrow(
      'Could not download scrcpy server: connection reset'
    )

    expect(existsSync(scrcpyServerJarPath())).toBe(false)
  })

  it('rejects protocol downgrades before following the redirect', async () => {
    const request = installRequest((activeRequest) => {
      activeRequest.emit('redirect', 302, 'GET', 'http://downloads.example.test/server.jar', {})
    })

    await expect(ensureScrcpyServerJar()).rejects.toThrow(
      'Could not download scrcpy server: refusing non-https redirect to http:'
    )

    expect(request.followRedirect).not.toHaveBeenCalled()
    expect(request.abort).toHaveBeenCalledOnce()
  })
})
