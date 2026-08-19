import type { RequestOptions } from 'node:http'
import { HttpError, type CancellationToken } from 'builder-util-runtime'
import { session } from 'electron'
import { readResponseTextWithLimit } from '../updater-response-body'
import {
  stripUnsafeCrossOriginHeaders,
  toFetchHeaders
} from './product-updater-cross-origin-headers'
import {
  isInitialRequestWithinActiveFeed,
  requestOptionsToUrl
} from './product-updater-executor-request-policy'
import type { ProductUpdaterExecutorState } from './product-updater-http-executor-types'
import {
  isAllowedProductUpdaterRequest,
  isAllowedProductUpdaterRedirectTarget
} from './product-updater-network-policy'

const MAX_UPDATER_REDIRECTS = 3
const MAX_UPDATER_METADATA_BYTES = 256 * 1024
const UPDATER_REQUEST_TIMEOUT_MS = 60_000

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Best effort: cancellation must not replace the updater policy error.
  }
}

async function fetchUpdaterMetadata(
  options: RequestOptions,
  state: ProductUpdaterExecutorState,
  signal: AbortSignal
): Promise<string | null> {
  let currentUrl = requestOptionsToUrl(options),
    redirects = 0
  const headers = toFetchHeaders(options.headers)
  const updaterSession = session.fromPartition('electron-updater', { cache: false })

  if (!isInitialRequestWithinActiveFeed(options, state)) {
    throw new Error('Updater metadata request is outside the active update feed')
  }

  while (true) {
    const isAllowed =
      redirects === 0
        ? isAllowedProductUpdaterRequest(
            currentUrl.href,
            state.productRepository,
            state.getMode(),
            state.getLocalFeedUrl(),
            [],
            state.getReleaseFeedUrl()
          )
        : isAllowedProductUpdaterRedirectTarget(
            currentUrl.href,
            state.productRepository,
            state.getMode(),
            state.getLocalFeedUrl(),
            state.getReleaseFeedUrl()
          )
    if (!isAllowed) {
      throw new Error('Updater metadata request was blocked by the product network boundary')
    }
    const response = await updaterSession.fetch(currentUrl.href, {
      headers,
      method: 'GET',
      redirect: 'manual',
      signal
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await cancelResponseBody(response)
      if (!location) {
        throw new Error('Updater metadata redirect did not include a location')
      }
      if (redirects >= MAX_UPDATER_REDIRECTS) {
        throw new Error('Too many updater redirects')
      }
      const nextUrl = new URL(location, currentUrl)
      if (nextUrl.origin !== currentUrl.origin) {
        stripUnsafeCrossOriginHeaders(headers)
      }
      state.authorizeRedirectUrl(nextUrl.href, state.getAuthorityEpoch())
      currentUrl = nextUrl
      redirects += 1
      continue
    }
    if (!response.ok) {
      await cancelResponseBody(response)
      throw new HttpError(response.status, `Updater metadata request failed (${response.status})`)
    }
    const body = await readResponseTextWithLimit(response, MAX_UPDATER_METADATA_BYTES, signal)
    if (body === null) {
      throw new Error('Updater metadata response exceeded the 256 KiB limit')
    }
    return body.length === 0 ? null : body
  }
}

export function boundedMetadataRequest(
  options: RequestOptions,
  cancellationToken: CancellationToken | undefined,
  state: ProductUpdaterExecutorState
): Promise<string | null> {
  const run = (resolve: (result: string | null) => void, reject: (error: Error) => void) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), UPDATER_REQUEST_TIMEOUT_MS)
    const finish = () => clearTimeout(timeout)
    fetchUpdaterMetadata(options, state, controller.signal)
      .then((result) => {
        finish()
        resolve(result)
      })
      .catch((error: unknown) => {
        finish()
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    return controller
  }

  if (!cancellationToken) {
    return new Promise((resolve, reject) => {
      run(resolve, reject)
    })
  }
  return cancellationToken.createPromise((resolve, reject, onCancel) => {
    const controller = run(resolve, reject)
    onCancel(() => controller.abort())
  })
}
