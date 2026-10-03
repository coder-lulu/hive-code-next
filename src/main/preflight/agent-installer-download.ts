import { getMainHttpClient } from '../network/http-client'

export async function downloadAgentInstaller(url: string, maxBytes = 1024 * 1024): Promise<Buffer> {
  const response = await getMainHttpClient().fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
    await response.body?.cancel()
    throw new Error('installer-download-failed')
  }
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('installer-download-failed')
  }
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new Error('installer-download-failed')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (!size) {
    throw new Error('installer-download-failed')
  }
  return Buffer.concat(chunks)
}
