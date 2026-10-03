import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import { HiveRuntimeCloudClient, HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'

function failedResponse(retryAfter: string): Response {
  return new Response(JSON.stringify({ code: 'runtime_busy' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'retry-after': retryAfter }
  })
}

async function lookupFailure(retryAfter: string): Promise<HiveRuntimeCloudRequestError> {
  const client = new HiveRuntimeCloudClient(
    'https://api.hivekernel.com',
    vi.fn().mockResolvedValue(failedResponse(retryAfter))
  )
  try {
    await client.lookup({})
    throw new Error('expected_lookup_failure')
  } catch (error) {
    if (!(error instanceof HiveRuntimeCloudRequestError)) {
      throw error
    }
    return error
  }
}

afterEach(() => vi.useRealTimers())

describe('Hive Runtime Cloud Retry-After parsing', () => {
  it.each([
    ['integer seconds', '7', 7_000],
    ['a delay longer than the local backoff cap', '60', 60_000],
    ['the Node timer safety cap', '999999999999999999', 2_147_483_647],
    ['a negative delay', '-1', null],
    ['a fractional delay', '1.5', null],
    ['an invalid date', 'not-a-date', null]
  ])('parses %s', async (_case, header, expected) => {
    await expect(lookupFailure(header)).resolves.toMatchObject({
      status: 503,
      category: 'runtime_busy',
      retryAfterMs: expected
    })
  })

  it('parses an HTTP date relative to the client clock', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-09-03T00:00:00.000Z')

    await expect(lookupFailure('Thu, 03 Sep 2026 00:00:12 GMT')).resolves.toMatchObject({
      retryAfterMs: 12_000
    })
  })

  it('also preserves Retry-After on GET failures', async () => {
    const client = new HiveRuntimeCloudClient(
      'https://api.hivekernel.com',
      vi.fn().mockResolvedValue(failedResponse('3'))
    )

    await expect(client.listOwnedRuntimes('token', null, 50)).rejects.toMatchObject({
      status: 503,
      retryAfterMs: 3_000
    })
  })
})
