import type { HiveAccountRuntimeDirectoryEntry } from '../../shared/hive-runtime-cloud'
import {
  HiveRuntimeCloudRequestError,
  HiveRuntimeCloudClient,
  type HiveRuntimeCloudTransportError
} from './hive-runtime-cloud-client'

export type HiveAccountRuntimeDirectoryClient = {
  listOwnedRuntimes: HiveRuntimeCloudClient['listOwnedRuntimes']
  createConnectionIntent?: HiveRuntimeCloudClient['createConnectionIntent']
  getOwnedRuntime?: HiveRuntimeCloudClient['getOwnedRuntime']
  updateOwnedRuntimeDisplayName?: HiveRuntimeCloudClient['updateOwnedRuntimeDisplayName']
}

export type HiveAccountRuntimeDirectoryDependencies = Readonly<{
  createClient: (apiBaseUrl: string) => HiveAccountRuntimeDirectoryClient
  now: () => number
}>

export const defaultHiveAccountRuntimeDirectoryDependencies: HiveAccountRuntimeDirectoryDependencies =
  {
    createClient: (apiBaseUrl) => new HiveRuntimeCloudClient(apiBaseUrl),
    now: Date.now
  }

const PAGE_SIZE = 100
const MAXIMUM_DIRECTORY_ITEMS = 10_000
const MAXIMUM_DIRECTORY_PAGES = Math.ceil(MAXIMUM_DIRECTORY_ITEMS / PAGE_SIZE)

export async function loadHiveAccountRuntimeDirectory(args: {
  client: Pick<HiveRuntimeCloudClient, 'listOwnedRuntimes'>
  accessToken: string
  signal: AbortSignal
  assertCurrent: () => void
}): Promise<readonly HiveAccountRuntimeDirectoryEntry[]> {
  const items: HiveAccountRuntimeDirectoryEntry[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | null = null
  let pageCount = 0
  do {
    pageCount += 1
    if (pageCount > MAXIMUM_DIRECTORY_PAGES) {
      throw new Error('hive_runtime_cloud_directory_page_limit')
    }
    const page = await args.client.listOwnedRuntimes(
      args.accessToken,
      cursor,
      PAGE_SIZE,
      args.signal
    )
    args.assertCurrent()
    for (const entry of page.items) {
      if (ids.has(entry.runtimeRecordId)) {
        throw new Error('hive_runtime_cloud_directory_duplicate')
      }
      ids.add(entry.runtimeRecordId)
      items.push(entry)
      if (items.length > MAXIMUM_DIRECTORY_ITEMS) {
        throw new Error('hive_runtime_cloud_directory_too_large')
      }
    }
    cursor = page.nextCursor
    if (cursor !== null && cursors.has(cursor)) {
      throw new Error('hive_runtime_cloud_directory_cursor_loop')
    }
    if (cursor !== null) {
      cursors.add(cursor)
    }
  } while (cursor !== null)
  return items
}

export function hiveAccountRuntimeDirectoryErrorCode(error: unknown): string {
  if (error instanceof HiveRuntimeCloudRequestError) {
    return error.status === 401
      ? 'SESSION_REJECTED'
      : error.status === 429
        ? 'RATE_LIMITED'
        : (error.category ?? 'REQUEST_FAILED')
  }
  if (
    (error as HiveRuntimeCloudTransportError | undefined)?.name === 'HiveRuntimeCloudTransportError'
  ) {
    return 'NETWORK_UNAVAILABLE'
  }
  return 'INVALID_RESPONSE'
}
