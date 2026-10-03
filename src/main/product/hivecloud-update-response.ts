export const MAX_UPDATE_RESPONSE_BYTES = 256 * 1024

/** Read a response body with a hard cap so a compromised endpoint cannot exhaust memory. */
export async function readHiveCloudUpdateJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > MAX_UPDATE_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('HiveCloud update response is too large')
  }
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_UPDATE_RESPONSE_BYTES) {
      throw new Error('HiveCloud update response is too large')
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
      if (total > MAX_UPDATE_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('HiveCloud update response is too large')
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
