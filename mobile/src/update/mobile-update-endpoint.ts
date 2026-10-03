import { hivecodeProductConfig } from '../generated/product-config'
import { MAX_UPDATE_URL_LENGTH, HIVECLOUD_UPDATE_CHECK_PATH } from './mobile-update-contract'
export function updateEndpointOrigin(): string | null {
  try {
    const endpoint = hivecodeProductConfig.services.update.checkEndpoint ?? ''
    if (endpoint.length > MAX_UPDATE_URL_LENGTH) {
      return null
    }
    const url = new URL(endpoint)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.pathname.includes('%') ||
      url.pathname !== HIVECLOUD_UPDATE_CHECK_PATH
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export async function readJsonWithLimit(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel()
    throw new Error('更新检查响应过大')
  }
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error('更新检查响应过大')
    }
    return JSON.parse(text)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('更新检查响应过大')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}
