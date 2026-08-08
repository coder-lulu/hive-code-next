import { describe, expect, it, vi } from 'vitest'
import { readResponseTextWithLimit } from './updater-response-body'

function streamedResponse(chunks: Uint8Array[], cancelResult: Promise<void> = Promise.resolve()) {
  const read = vi.fn()
  for (const chunk of chunks) {
    read.mockResolvedValueOnce({ done: false, value: chunk })
  }
  read.mockResolvedValueOnce({ done: true, value: undefined })
  const cancel = vi.fn(() => cancelResult)
  const releaseLock = vi.fn()
  const text = vi.fn(() => Promise.resolve('fallback must not run'))
  return {
    response: {
      headers: { get: () => null },
      body: { getReader: () => ({ read, cancel, releaseLock }) },
      text
    } as unknown as Response,
    cancel,
    releaseLock,
    text
  }
}

describe('readResponseTextWithLimit', () => {
  it('cancels a stream as soon as its byte limit is exceeded', async () => {
    const { response, cancel, releaseLock, text } = streamedResponse([
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8])
    ])

    await expect(readResponseTextWithLimit(response, 6)).resolves.toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(text).not.toHaveBeenCalled()
  })

  it('cancels the response body before rejecting an oversized Content-Length', async () => {
    const cancel = vi.fn(() => Promise.resolve())
    const response = {
      headers: { get: () => '32' },
      body: { cancel },
      text: vi.fn()
    } as unknown as Response

    await expect(readResponseTextWithLimit(response, 8)).resolves.toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(response.text).not.toHaveBeenCalled()
  })

  it('keeps an oversized response rejected when stream cleanup throws', async () => {
    const { response, cancel, releaseLock } = streamedResponse(
      [new Uint8Array([1, 2, 3, 4])],
      Promise.reject(new Error('cancel failed'))
    )
    releaseLock.mockImplementation(() => {
      throw new Error('release failed')
    })

    await expect(readResponseTextWithLimit(response, 2)).resolves.toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(releaseLock).toHaveBeenCalledTimes(1)
  })

  it('decodes UTF-8 characters split across chunks without corrupting them', async () => {
    const encoded = new TextEncoder().encode('Product 蜂核')
    const { response, cancel, releaseLock } = streamedResponse([
      encoded.slice(0, -1),
      encoded.slice(-1)
    ])

    await expect(readResponseTextWithLimit(response, encoded.length)).resolves.toBe('Product 蜂核')
    expect(cancel).not.toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalledTimes(1)
  })

  it('aborts a pending stream read and releases the response when its signal is cancelled', async () => {
    let resolveRead!: (result: { done: boolean; value?: Uint8Array }) => void
    const read = vi.fn(
      () =>
        new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
          resolveRead = resolve
        })
    )
    const cancel = vi.fn(() => Promise.resolve())
    const releaseLock = vi.fn()
    const response = {
      headers: { get: () => null },
      body: { getReader: () => ({ read, cancel, releaseLock }) },
      text: vi.fn()
    } as unknown as Response
    const controller = new AbortController()
    const readWithSignal = readResponseTextWithLimit as unknown as (
      response: Response,
      maxBytes: number,
      signal: AbortSignal
    ) => Promise<string | null>

    const pending = readWithSignal(response, 32, controller.signal)
    controller.abort()
    const result = await Promise.race([
      pending.then(
        () => 'settled',
        () => 'rejected'
      ),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 100))
    ])

    expect(result).toBe('rejected')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(releaseLock).toHaveBeenCalledTimes(1)
    resolveRead({ done: true })
  })

  it('cancels and releases the response when the stream reader rejects', async () => {
    const readError = new Error('stream failed')
    const cancel = vi.fn(() => Promise.resolve())
    const releaseLock = vi.fn()
    const response = {
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: vi.fn(() => Promise.reject(readError)),
          cancel,
          releaseLock
        })
      }
    } as unknown as Response

    await expect(readResponseTextWithLimit(response, 32)).rejects.toBe(readError)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(releaseLock).toHaveBeenCalledTimes(1)
  })
})
