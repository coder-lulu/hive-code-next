import { app, net } from 'electron'
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { EmulatorError } from '../emulator-errors'
import { emulatorProbe, emulatorProbeError } from '../emulator-probe'
import { SCRCPY_SERVER_VERSION } from './scrcpy-server-deploy'

// The scrcpy server jar is fetched by the client on first use (not bundled in
// the repo) into the per-user cache, pinned to the version our client protocol
// targets. The GitHub release asset is unversioned-extension, so we store it as .jar.
const DOWNLOAD_URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_SERVER_VERSION}/scrcpy-server-v${SCRCPY_SERVER_VERSION}`
const MIN_VALID_BYTES = 10_000
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5

type DownloadIncomingMessage = Electron.IncomingMessage &
  NodeJS.ReadableStream & { destroy?: () => void }

export function scrcpyServerJarPath(): string {
  return join(app.getPath('userData'), 'scrcpy', `scrcpy-server-v${SCRCPY_SERVER_VERSION}.jar`)
}

export function isScrcpyServerJarReady(): boolean {
  try {
    const path = scrcpyServerJarPath()
    return existsSync(path) && statSync(path).size >= MIN_VALID_BYTES
  } catch {
    return false
  }
}

let inFlightDownload: Promise<string> | null = null

// Returns the cached jar path, downloading it once if missing. Concurrent callers
// (e.g. two devices on first run) share one download. Throws a clear
// EmulatorError when the download fails (e.g. offline).
export async function ensureScrcpyServerJar(): Promise<string> {
  const path = scrcpyServerJarPath()
  if (isScrcpyServerJarReady()) {
    return path
  }
  if (!inFlightDownload) {
    inFlightDownload = downloadScrcpyServerJar(path).finally(() => {
      inFlightDownload = null
    })
  }
  return inFlightDownload
}

async function downloadScrcpyServerJar(path: string): Promise<string> {
  emulatorProbe('scrcpy.jar.download.start', { url: DOWNLOAD_URL, dest: path })
  mkdirSync(dirname(path), { recursive: true })
  try {
    await downloadTo(DOWNLOAD_URL, path)
  } catch (error) {
    rmSync(path, { force: true })
    emulatorProbeError('scrcpy.jar.download.fail', error, { url: DOWNLOAD_URL })
    const detail = error instanceof Error ? error.message : 'unknown error'
    throw new EmulatorError('emulator_helper_failed', `Could not download scrcpy server: ${detail}`)
  }
  if (!isScrcpyServerJarReady()) {
    rmSync(path, { force: true })
    throw new EmulatorError(
      'emulator_helper_failed',
      'Downloaded scrcpy server was invalid or truncated.'
    )
  }
  emulatorProbe('scrcpy.jar.download.ok', { dest: path, bytes: statSync(path).size })
  return path
}

function downloadTo(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let currentUrl: URL
    try {
      currentUrl = new URL(url)
    } catch {
      reject(new Error('invalid download URL'))
      return
    }
    if (currentUrl.protocol !== 'https:') {
      reject(new Error(`refusing non-https URL using ${currentUrl.protocol}`))
      return
    }

    // Electron net.request uses Chromium's default session, including the app-wide proxy.
    // Its redirect event also lets us keep the existing HTTPS-only redirect policy.
    const request = net.request({ method: 'GET', url: currentUrl.toString(), redirect: 'manual' })
    let response: DownloadIncomingMessage | null = null
    let fileStream: ReturnType<typeof createWriteStream> | null = null
    let streamAbortError: Error | null = null
    let redirects = 0
    let settled = false
    let idleTimeout: ReturnType<typeof setTimeout> | null = null

    const clearIdleTimeout = (): void => {
      if (idleTimeout) {
        clearTimeout(idleTimeout)
        idleTimeout = null
      }
    }
    const resetIdleTimeout = (): void => {
      clearIdleTimeout()
      idleTimeout = setTimeout(onIdleTimeout, DOWNLOAD_IDLE_TIMEOUT_MS)
    }
    const cleanup = (): void => {
      clearIdleTimeout()
      request.off('error', onRequestError)
      request.off('redirect', onRedirect)
      request.off('response', onResponse)
    }
    const resolveOnce = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve()
    }
    const rejectOnce = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    const abortWith = (error: Error): void => {
      const activeResponse = response
      if (fileStream) {
        streamAbortError ??= error
      }
      request.abort()
      activeResponse?.destroy?.()
      if (fileStream) {
        // Let pipeline close the Windows file handle before the outer failure path removes it.
        fileStream.destroy()
        return
      }
      rejectOnce(error)
    }
    const onIdleTimeout = (): void => abortWith(new Error('download timed out'))
    const onRequestError = (error: Error): void => abortWith(error)
    const onRedirect = (_statusCode: number, _method: string, redirectUrl: string): void => {
      if (redirects >= MAX_REDIRECTS) {
        abortWith(new Error('too many redirects'))
        return
      }
      let next: URL
      try {
        next = new URL(redirectUrl, currentUrl)
      } catch {
        abortWith(new Error('invalid redirect URL'))
        return
      }
      if (next.protocol !== 'https:') {
        abortWith(new Error(`refusing non-https redirect to ${next.protocol}`))
        return
      }
      currentUrl = next
      redirects += 1
      resetIdleTimeout()
      // Electron requires this synchronously inside the redirect event.
      request.followRedirect()
    }
    const onResponse = (incoming: Electron.IncomingMessage): void => {
      response = incoming as DownloadIncomingMessage
      resetIdleTimeout()
      if (response.statusCode !== 200) {
        abortWith(new Error(`HTTP ${response.statusCode}`))
        return
      }
      fileStream = createWriteStream(dest)
      const activity = new Transform({
        transform(chunk, _encoding, callback) {
          resetIdleTimeout()
          callback(null, chunk)
        }
      })
      pipeline(response, activity, fileStream).then(
        () => (streamAbortError ? rejectOnce(streamAbortError) : resolveOnce()),
        (error: Error) => rejectOnce(streamAbortError ?? error)
      )
    }

    resetIdleTimeout()
    request.on('error', onRequestError)
    request.on('redirect', onRedirect)
    request.on('response', onResponse)
    request.end()
  })
}
