import type { RequestOptions } from 'node:http'
import { CancellationError } from 'builder-util-runtime'
import {
  isAllowedHiveCloudArtifactRequest,
  isAllowedHiveCloudArtifactCdnRequest,
  isHiveCloudReleaseFeed
} from './hivecloud-updater-network-policy'
import {
  isAllowedProductUpdaterRedirectTarget,
  type ProductUpdaterNetworkMode
} from './product-updater-network-policy'
import { sanitizeCrossOriginHeaders } from './product-updater-cross-origin-headers'
import {
  isInitialRequestWithinActiveFeed,
  requestOptionsToUrl
} from './product-updater-executor-request-policy'
import type {
  ProductUpdaterExecutorState,
  ProductUpdaterHttpExecutor
} from './product-updater-http-executor-types'
import { boundedMetadataRequest } from './product-updater-metadata-request'

const MAX_UPDATER_REDIRECTS = 3
const REDIRECT_DEPTH = Symbol.for('product.updater.redirectDepth')
const REDIRECT_AUTHORITY = Symbol.for('product.updater.redirectAuthority')

const executorStates = new WeakMap<ProductUpdaterHttpExecutor, ProductUpdaterExecutorState>()
const patchedExecutors = new WeakSet<ProductUpdaterHttpExecutor>()

function getRedirectDepth(options: RequestOptions): number {
  const value = (options as unknown as Record<PropertyKey, unknown>)[REDIRECT_DEPTH]
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function setRedirectDepth(options: RequestOptions, depth: number): void {
  ;(options as unknown as Record<PropertyKey, unknown>)[REDIRECT_DEPTH] = depth
}

function hasRedirectAuthority(
  options: RequestOptions,
  state: ProductUpdaterExecutorState
): boolean {
  return (
    (options as unknown as Record<PropertyKey, unknown>)[REDIRECT_AUTHORITY] ===
    state.getAuthorityEpoch()
  )
}

function isAuthorizedExecutorRequest(
  options: RequestOptions,
  state: ProductUpdaterExecutorState
): boolean {
  if (!hasRedirectAuthority(options, state)) {
    return (
      isInitialRequestWithinActiveFeed(options, state) ||
      (state.getMode() === 'release' &&
        isAllowedHiveCloudArtifactRequest(requestOptionsToUrl(options), state.getReleaseFeedUrl()))
    )
  }
  return isAllowedProductUpdaterRedirectTarget(
    requestOptionsToUrl(options).href,
    state.productRepository,
    state.getMode(),
    state.getLocalFeedUrl(),
    state.getReleaseFeedUrl()
  )
}

function patchRedirectOptionPropagation(executor: ProductUpdaterHttpExecutor): void {
  if (typeof executor.addRedirectHandlers !== 'function') {
    throw new Error('Updater HTTP executor redirect handler is unavailable')
  }
  const originalAddRedirectHandlers = executor.addRedirectHandlers
  executor.addRedirectHandlers = function boundedRedirectHandlers(
    request,
    options,
    reject,
    redirectCount,
    handler
  ) {
    const state = executorStates.get(this)
    if (!state || !isAuthorizedExecutorRequest(options, state)) {
      reject(new Error('Updater request is outside the active update feed'))
      return
    }
    const previousUrl = requestOptionsToUrl(options)
    const authorityEpoch = state.getAuthorityEpoch()
    return originalAddRedirectHandlers.call(
      this,
      request,
      options,
      reject,
      redirectCount,
      (next) => {
        const nextUrl = requestOptionsToUrl(next)
        if (
          state.getAuthorityEpoch() !== authorityEpoch ||
          (isHiveCloudReleaseFeed(state.getReleaseFeedUrl()) &&
            (getRedirectDepth(options) !== 0 ||
              !isAllowedHiveCloudArtifactRequest(previousUrl, state.getReleaseFeedUrl()) ||
              !isAllowedHiveCloudArtifactCdnRequest(nextUrl))) ||
          !isAllowedProductUpdaterRedirectTarget(
            nextUrl.href,
            state.productRepository,
            state.getMode(),
            state.getLocalFeedUrl(),
            state.getReleaseFeedUrl()
          )
        ) {
          reject(new Error('Updater redirect is outside the product network boundary'))
          return
        }
        if (nextUrl.origin !== previousUrl.origin) {
          next.headers = sanitizeCrossOriginHeaders(next.headers)
          Object.assign(next, { credentials: 'omit', useSessionCookies: false })
        }
        setRedirectDepth(next, getRedirectDepth(options) + 1)
        ;(next as unknown as Record<PropertyKey, unknown>)[REDIRECT_AUTHORITY] = authorityEpoch
        state.authorizeRedirectUrl(nextUrl.href, authorityEpoch)
        handler(next)
      }
    )
  }
}

export function installProductUpdaterHttpExecutorBoundary(
  executor: ProductUpdaterHttpExecutor,
  productRepository: string | null,
  getMode: () => ProductUpdaterNetworkMode,
  getLocalFeedUrl: () => string | null = () => null,
  getReleaseFeedUrl: () => string | null = () => null,
  getAuthorityEpoch: () => number = () => 0,
  authorizeRedirectUrl: (url: string, epoch: number) => void = () => undefined
): void {
  executorStates.set(executor, {
    productRepository,
    getMode,
    getLocalFeedUrl,
    getReleaseFeedUrl,
    getAuthorityEpoch,
    authorizeRedirectUrl
  })
  if (patchedExecutors.has(executor)) {
    return
  }
  patchedExecutors.add(executor)
  patchRedirectOptionPropagation(executor)

  executor.request = function boundedRequest(options, cancellationToken, data) {
    if (data !== undefined && data !== null) {
      return Promise.reject(new Error('Updater metadata POST requests are not allowed'))
    }
    const state = executorStates.get(this)
    if (!state) {
      return Promise.reject(new Error('Updater HTTP executor boundary state is unavailable'))
    }
    return boundedMetadataRequest(options, cancellationToken, state)
  }

  const originalDoApiRequest = executor.doApiRequest
  executor.doApiRequest = function boundedApiRequest(
    options,
    cancellationToken,
    requestProcessor,
    redirectCount
  ) {
    if (!Object.hasOwn(options, REDIRECT_DEPTH)) {
      setRedirectDepth(options, 0)
    }
    if (getRedirectDepth(options) > MAX_UPDATER_REDIRECTS) {
      return Promise.reject(new Error('Too many updater redirects'))
    }
    const state = executorStates.get(this)
    if (!state || !isAuthorizedExecutorRequest(options, state)) {
      return Promise.reject(new Error('Updater request is outside the active update feed'))
    }
    return originalDoApiRequest.call(
      this,
      options,
      cancellationToken,
      requestProcessor,
      redirectCount
    )
  }

  const originalDoDownload = executor.doDownload
  executor.doDownload = function boundedDownload(options, downloadOptions, redirectCount) {
    if (!Object.hasOwn(options, REDIRECT_DEPTH)) {
      setRedirectDepth(options, 0)
    }
    if (getRedirectDepth(options) > MAX_UPDATER_REDIRECTS) {
      downloadOptions.callback(new Error('Too many updater redirects'))
      return
    }
    const state = executorStates.get(this)
    if (!state || !isAuthorizedExecutorRequest(options, state)) {
      downloadOptions.callback(new Error('Updater request is outside the active update feed'))
      return
    }
    if (isAllowedHiveCloudArtifactCdnRequest(requestOptionsToUrl(options))) {
      const report = (error: unknown): void => {
        if (error == null) {
          downloadOptions.callback(null)
          return
        }
        if (error instanceof CancellationError) {
          downloadOptions.callback(new CancellationError())
          return
        }
        const status =
          error instanceof Error ? /\bstatus ([45]\d{2})\b/.exec(error.message)?.[1] : undefined
        downloadOptions.callback(
          new Error(`HiveCloud CDN download failed${status ? ` (HTTP ${status})` : ''}`)
        )
      }
      try {
        originalDoDownload.call(
          this,
          options,
          { ...downloadOptions, callback: report },
          redirectCount
        )
      } catch (error) {
        report(error)
      }
      return
    }
    originalDoDownload.call(this, options, downloadOptions, redirectCount)
  }
}
