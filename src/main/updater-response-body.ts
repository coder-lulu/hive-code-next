export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    return null
  }

  const contentLengthValue = response.headers?.get('content-length') ?? null
  if (contentLengthValue !== null) {
    const contentLength = Number(contentLengthValue)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maxBytes) {
      try {
        await response.body?.cancel()
      } catch {
        // Best effort: cleanup failures must not reopen a response already rejected by policy.
      }
      return null
    }
  }

  const reader = response.body?.getReader()
  if (!reader) {
    const text = await readTextWithAbort(response, signal)
    return new TextEncoder().encode(text).byteLength <= maxBytes ? text : null
  }

  const decoder = new TextDecoder()
  const chunks: string[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await readChunkWithAbort(reader, signal)
      if (done) {
        chunks.push(decoder.decode())
        return chunks.join('')
      }
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // Best effort: preserve the fail-closed oversize verdict.
        }
        return null
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Best effort: callers care about the bounded-read verdict, not cleanup failures.
    }
  }
}

async function readTextWithAbort(response: Response, signal?: AbortSignal): Promise<string> {
  if (!signal) {
    return response.text()
  }
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) {
        return
      }
      settled = true
      void response.body?.cancel().catch(() => undefined)
      cleanup()
      reject(new Error('Updater response body read aborted'))
    }
    const resolveOnce = (value: string) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }
    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    response.text().then(resolveOnce, rejectOnce)
  })
}

async function readChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) {
    try {
      return await reader.read()
    } catch (error) {
      void reader.cancel().catch(() => undefined)
      throw error
    }
  }
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) {
        return
      }
      settled = true
      void reader.cancel().catch(() => undefined)
      cleanup()
      reject(new Error('Updater response body read aborted'))
    }
    const resolveOnce = (value: ReadableStreamReadResult<Uint8Array>) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }
    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      void reader.cancel().catch(() => undefined)
      cleanup()
      reject(error)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    reader.read().then(resolveOnce, rejectOnce)
  })
}
