import { afterEach, expect, it, vi } from 'vitest'
import {
  HiveRuntimeCloudHttpClient,
  HiveRuntimeCloudTransportError
} from './hive-runtime-cloud-http-client'

class TestClient extends HiveRuntimeCloudHttpClient {
  read(method: 'GET' | 'POST') {
    return method === 'GET' ? this.get('/test', null) : this.request('/test', {}, {}, 200)
  }
}

afterEach(() => vi.useRealTimers())

it.each(['GET', 'POST'] as const)(
  'classifies %s body timeout after headers as transport failure',
  async (method) => {
    vi.useFakeTimers()
    const client = new TestClient(
      'https://test.invalid',
      async (_url, { signal }) =>
        new Response(
          new ReadableStream({
            start(controller) {
              signal!.addEventListener(
                'abort',
                () => controller.error(new DOMException('aborted', 'AbortError')),
                { once: true }
              )
            }
          }),
          { status: 200 }
        )
    )
    const result = client.read(method).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await result).toBeInstanceOf(HiveRuntimeCloudTransportError)
  }
)

it('classifies a connection reset while streaming a body as transport failure', async () => {
  const client = new TestClient(
    'https://test.invalid',
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated'))
          }
        })
      )
  )
  await expect(client.read('POST')).rejects.toBeInstanceOf(HiveRuntimeCloudTransportError)
})

it.each(['{', 'x'.repeat(65_537)])(
  'keeps invalid and oversized bodies as protocol errors',
  async (body) => {
    const client = new TestClient('https://test.invalid', async () => new Response(body))
    const error = await client.read('POST').catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(HiveRuntimeCloudTransportError)
  }
)
