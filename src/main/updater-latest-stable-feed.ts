import { net, session } from 'electron'
import { resolveProductUpdateSource } from '../shared/product-update-source'
import { PRODUCT_UPDATER_SESSION_PARTITION } from './product/product-updater-session'
const FETCH_TIMEOUT_MS = 5000
function isCanonicalStableTag(tag: string): boolean {
  return /^v\d+\.\d+\.\d+$/.test(tag)
}
export async function probeLatestStableReleaseTag(
  isReady: (tag: string) => Promise<boolean>
): Promise<string | null> {
  const github = resolveProductUpdateSource()?.github
  if (!github) {
    return null
  }
  const latestUrl = `https://github.com/${github.repo}/releases/latest`
  const location = await new Promise<string | null>((resolve) => {
    const request = net.request({
      method: 'HEAD',
      url: latestUrl,
      redirect: 'manual',
      session: session.fromPartition(PRODUCT_UPDATER_SESSION_PARTITION, { cache: false })
    })
    let settled = false
    const finish = (url: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve(url)
      request.abort()
    }
    const timeout = setTimeout(() => finish(null), FETCH_TIMEOUT_MS)
    request.on('redirect', (status, _method, url) =>
      finish(status >= 300 && status < 400 ? url : null)
    )
    request.on('response', () => finish(null))
    request.on('error', () => finish(null))
    try {
      request.end()
    } catch {
      finish(null)
    }
  }).catch(() => null)
  if (!location) {
    return null
  }
  try {
    const target = new URL(location, latestUrl)
    const prefix = `/${github.repo}/releases/tag/`
    if (
      target.origin !== 'https://github.com' ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      !target.pathname.startsWith(prefix)
    ) {
      return null
    }
    const tag = decodeURIComponent(target.pathname.slice(prefix.length))
    if (!isCanonicalStableTag(tag)) {
      return null
    }
    return (await isReady(tag)) ? tag : null
  } catch {
    return null
  }
}
