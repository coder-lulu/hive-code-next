import type { RequestOptions } from 'node:http'
import { isAllowedProductUpdaterRequest } from './product-updater-network-policy'
import type { ProductUpdaterExecutorState } from './product-updater-http-executor-types'

export function requestOptionsToUrl(options: RequestOptions): URL {
  if (options.auth || (options.method && options.method.toUpperCase() !== 'GET')) {
    throw new Error('Unsupported updater metadata request options')
  }
  const protocol = options.protocol
  const rawHostname = options.hostname
  const path = options.path
  if (
    (protocol !== 'https:' && protocol !== 'http:') ||
    !rawHostname ||
    !path ||
    !path.startsWith('/')
  ) {
    throw new Error('Invalid updater metadata request URL')
  }
  const hostname =
    rawHostname.includes(':') && !rawHostname.startsWith('[') ? `[${rawHostname}]` : rawHostname
  const port = options.port === undefined || options.port === null ? '' : `:${String(options.port)}`
  return new URL(`${protocol}//${hostname}${port}${path}`)
}

export function isInitialRequestWithinActiveFeed(
  options: RequestOptions,
  state: ProductUpdaterExecutorState
): boolean {
  const requestUrl = requestOptionsToUrl(options)
  const mode = state.getMode()
  const feedUrl = mode === 'local' ? state.getLocalFeedUrl() : state.getReleaseFeedUrl()
  let feed: URL
  try {
    feed = new URL(feedUrl ?? '')
  } catch {
    return false
  }
  return (
    !feed.username &&
    !feed.password &&
    !feed.search &&
    !feed.hash &&
    feed.pathname.endsWith('/') &&
    requestUrl.origin === feed.origin &&
    requestUrl.pathname.startsWith(feed.pathname) &&
    isAllowedProductUpdaterRequest(
      requestUrl.href,
      state.productRepository,
      mode,
      state.getLocalFeedUrl()
    )
  )
}
