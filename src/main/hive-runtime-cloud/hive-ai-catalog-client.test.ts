import { describe, expect, it, vi } from 'vitest'
import { HiveAiCatalogClient } from './hive-ai-catalog-client'

const catalog = {
  snapshotRevision: 'a'.repeat(64),
  asOf: '2026-09-14T06:00:00Z',
  scope: 'ACCOUNT',
  models: [
    {
      modelId: 'vendor/model',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      protocols: ['RESPONSES']
    }
  ]
}
describe('current-account catalog HTTP boundary', () => {
  it('uses a fixed read-only GET with the main-process Hive credential and no Runtime proof', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(catalog))
    const client = new HiveAiCatalogClient('https://cloud.example.test', fetcher)
    expect(await client.catalog({ accessToken: 'hive-private-token' })).toEqual(catalog)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe('https://cloud.example.test/hive/v1/ai/models')
    const init = fetcher.mock.calls[0][1]
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' })
    expect(init.body).toBeUndefined()
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer hive-private-token')
    expect(headers.has('X-Hive-AI-Proof')).toBe(false)
    expect(headers.has('cookie')).toBe(false)
  })
  it('prepares inference credentials explicitly before reading models when requested', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ prepared: true }))
      .mockResolvedValueOnce(Response.json(catalog))
    const client = new HiveAiCatalogClient('https://cloud.example.test', fetcher)
    expect(await client.catalog({ accessToken: 'token', prepare: true })).toEqual(catalog)
    expect(fetcher.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['https://cloud.example.test/hive/v1/ai/models/prepare', 'POST'],
      ['https://cloud.example.test/hive/v1/ai/models', 'GET']
    ])
  })
  it('does not read or retry after preparation is rejected', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 'CONFLICT' }, { status: 409 }))
    const client = new HiveAiCatalogClient('https://cloud.example.test', fetcher)
    await expect(client.catalog({ accessToken: 'token', prepare: true })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each([
    'http://cloud.example.test',
    'https://user:secret@cloud.example.test',
    'https://cloud.example.test/path',
    'https://cloud.example.test/?token=secret'
  ])('rejects invalid origin %s', (origin) =>
    expect(() => new HiveAiCatalogClient(origin)).toThrow('invalid_origin')
  )
  it('does not send cancelled or malformed credentials', async () => {
    const fetcher = vi.fn()
    const client = new HiveAiCatalogClient('https://cloud.example.test', fetcher)
    for (const accessToken of ['', 'token\nsecret', 'a'.repeat(8193)]) {
      await expect(client.catalog({ accessToken })).rejects.toThrow('invalid_identity')
    }
    await expect(
      client.catalog({ accessToken: 'token', signal: AbortSignal.abort() })
    ).rejects.toThrow('cancelled')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([401, 403, 409, 503])(
    'does not retry HTTP %s or reflect an upstream secret',
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(Response.json({ code: 'SECRET_CANARY' }, { status }))
      const client = new HiveAiCatalogClient('https://cloud.example.test', fetcher)
      await expect(client.catalog({ accessToken: 'token' })).rejects.toMatchObject({
        message: 'hive_ai_catalog_request_failed',
        status,
        code: null
      })
      expect(fetcher).toHaveBeenCalledOnce()
    }
  )
  it('rejects envelopes, secret fields and oversized responses', async () => {
    for (const response of [
      Response.json({ data: catalog }),
      Response.json({ ...catalog, key: 'SECRET_CANARY' }),
      new Response('x', { headers: { 'content-length': '65537' } })
    ]) {
      const client = new HiveAiCatalogClient('https://cloud.example.test', async () => response)
      await expect(client.catalog({ accessToken: 'token' })).rejects.toThrow()
    }
  })
})
