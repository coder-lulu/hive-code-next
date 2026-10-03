import { parseHiveRelayJson } from '../../../src/shared/hive-relay-json'

const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024

export async function readApiJsonWithinLimit(
  response: Response,
  maximumBytes = MAX_API_RESPONSE_BYTES
): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('mobile_api_response_too_large')
  }

  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maximumBytes) {
      throw new Error('mobile_api_response_too_large')
    }
    return parseHiveRelayJson(text, maximumBytes)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('mobile_api_response_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return parseHiveRelayJson(new TextDecoder().decode(bytes), maximumBytes)
}
