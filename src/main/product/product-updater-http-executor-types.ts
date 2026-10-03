import type { RequestOptions } from 'node:http'
import type { CancellationToken } from 'builder-util-runtime'
import type { ProductUpdaterNetworkMode } from './product-updater-network-policy'

type ProductUpdaterDownloadCallOptions = { callback: (error: Error | null) => void } & Record<
  string,
  unknown
>

export type ProductUpdaterHttpExecutor = {
  request: (
    options: RequestOptions,
    cancellationToken?: CancellationToken,
    data?: Record<string, unknown> | null
  ) => Promise<string | null>
  doApiRequest: (
    options: RequestOptions,
    cancellationToken: CancellationToken,
    requestProcessor: (request: unknown, reject: (error: Error) => void) => void,
    redirectCount?: number
  ) => Promise<string>
  doDownload: (
    options: RequestOptions,
    downloadOptions: ProductUpdaterDownloadCallOptions,
    redirectCount: number
  ) => void
  addRedirectHandlers: (
    request: unknown,
    options: RequestOptions,
    reject: (error: Error) => void,
    redirectCount: number,
    handler: (options: RequestOptions) => void
  ) => void
}

export type ProductUpdaterExecutorState = {
  productRepository: string | null
  getMode: () => ProductUpdaterNetworkMode
  getLocalFeedUrl: () => string | null
  getReleaseFeedUrl: () => string | null
  getAuthorityEpoch: () => number
  authorizeRedirectUrl: (url: string, epoch: number) => void
}
