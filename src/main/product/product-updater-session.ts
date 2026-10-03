import { session } from 'electron'

export const PRODUCT_UPDATER_SESSION_PARTITION = 'electron-updater'

export function fetchWithProductUpdaterSession(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const request = input instanceof URL ? input.href : input
  return session
    .fromPartition(PRODUCT_UPDATER_SESSION_PARTITION, { cache: false })
    .fetch(request, init)
}
