const MAX_RESPONSE_BYTES = 1024 * 1024

export class ReleaseHttpError extends Error {
  constructor(status) {
    super(`HiveCloud release request failed (${status})`)
    this.name = 'ReleaseHttpError'
    this.status = status
  }
}

export function httpsOrigin(value, name) {
  let url
  try {
    url = new URL(String(value ?? '').trim())
  } catch {
    throw new Error(`${name} must be an HTTPS origin`)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(`${name} must be an HTTPS origin`)
  }
  return url.origin
}

export async function readReleaseResponse(response) {
  if (!response.ok) {
    await response.body?.cancel()
    throw new ReleaseHttpError(response.status)
  }
  const chunks = []
  let size = 0
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error('HiveCloud release response is too large')
      }
      chunks.push(chunk)
    }
  } catch (error) {
    await response.body?.cancel().catch(() => {})
    throw error
  }
  let payload
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('HiveCloud release response is not valid JSON')
  }
  if (payload && Object.hasOwn(payload, 'code') && ![0, 200].includes(payload.code)) {
    throw new Error(`HiveCloud release operation failed (${payload.code})`)
  }
  return payload?.data ?? payload
}
