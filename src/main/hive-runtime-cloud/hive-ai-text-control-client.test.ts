import { describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { HiveAiTextControlClient } from './hive-ai-text-control-client'
import {
  controlCommand,
  controlOwner,
  controlReply
} from '../../shared/hive-ai-text-control.test-fixture'
const pair = generateKeyPairSync('ed25519')
const input = {
  command: controlCommand,
  owner: controlOwner,
  identity: {
    schemaVersion: 1 as const,
    runtimeInstanceId: controlCommand.runtime.runtimeInstanceId,
    privateKeyPkcs8: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: pair.publicKey
      .export({ type: 'spki', format: 'der' })
      .subarray(-32)
      .toString('base64url'),
    createdAt: Date.now()
  },
  authorityId: 'authority',
  accessToken: 'hive-private-token',
  assertCurrent: () => {}
}
describe('signed text status/cancel HTTP', () => {
  it.each(['status', 'cancel'] as const)(
    'uses fixed %s POST without retry or redirect',
    async (operation) => {
      const fetcher = vi.fn().mockResolvedValue(Response.json(controlReply))
      const client = new HiveAiTextControlClient('https://cloud.test', fetcher)
      expect(await client[operation](input)).toEqual(controlReply)
      expect(fetcher).toHaveBeenCalledOnce()
      const [url, init] = fetcher.mock.calls[0]!
      expect(url).toBe(`https://cloud.test/hive/v1/ai/inferences/${operation}`)
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' })
      expect(JSON.parse(init.body)).toEqual(controlCommand)
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBe('Bearer hive-private-token')
      expect(headers.has('cookie')).toBe(false)
      expect(headers.has('X-Hive-AI-Proof')).toBe(true)
    }
  )
  it.each([401, 403, 404, 409, 503])(
    'does not retry HTTP %s or reflect upstream content',
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(Response.json({ code: 'SECRET_CANARY' }, { status }))
      const client = new HiveAiTextControlClient('https://cloud.test', fetcher)
      await expect(client.cancel(input)).rejects.toMatchObject({
        message: 'hive_ai_control_request_failed',
        status,
        code: null
      })
      expect(fetcher).toHaveBeenCalledOnce()
    }
  )
  it('rejects missing or cancelled credentials before transport', async () => {
    const fetcher = vi.fn()
    const client = new HiveAiTextControlClient('https://cloud.test', fetcher)
    for (const accessToken of ['', 'token\nSECRET_CANARY', 'a'.repeat(8193)]) {
      await expect(client.status({ ...input, accessToken })).rejects.toThrow('invalid_identity')
    }
    await expect(client.status({ ...input, signal: AbortSignal.abort() })).rejects.toThrow(
      'cancelled'
    )
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('drops a late response after local authorization is revoked', async () => {
    let revoked = false
    const fetcher = vi.fn().mockImplementation(async () => {
      revoked = true
      return Response.json(controlReply)
    })
    const client = new HiveAiTextControlClient('https://cloud.test', fetcher)
    await expect(
      client.status({
        ...input,
        assertCurrent: () => {
          if (revoked) {
            throw new Error('SECRET_CANARY')
          }
        }
      })
    ).rejects.toThrow(/^hive_ai_control_unavailable$/)
  })
  it.each(['status', 'cancel'] as const)(
    'sanitizes %s authorization failure before transport',
    async (operation) => {
      const fetcher = vi.fn()
      const client = new HiveAiTextControlClient('https://cloud.test', fetcher)
      await expect(
        client[operation]({
          ...input,
          assertCurrent: () => {
            throw new Error('SECRET_CANARY')
          }
        })
      ).rejects.toThrow(/^hive_ai_control_unavailable$/)
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
  it('retains the originating authority guard when request options change in flight', async () => {
    let revoked = false
    const options = {
      ...input,
      assertCurrent: () => {
        if (revoked) {
          throw new Error('SECRET_CANARY')
        }
      }
    }
    const fetcher = vi.fn().mockImplementation(async () => {
      revoked = true
      options.assertCurrent = () => {}
      return Response.json(controlReply)
    })
    const client = new HiveAiTextControlClient('https://cloud.test', fetcher)
    await expect(client.status(options)).rejects.toThrow(/^hive_ai_control_unavailable$/)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('retains the originating abort signal when request options change in flight', async () => {
    const originating = new AbortController()
    const options = { ...input, signal: originating.signal }
    const fetcher = vi.fn().mockImplementation(async () => {
      originating.abort()
      options.signal = new AbortController().signal
      return Response.json(controlReply)
    })
    const client = new HiveAiTextControlClient('https://cloud.test', fetcher)
    await expect(client.cancel(options)).rejects.toThrow(/^hive_ai_control_unavailable$/)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('pins a mutable originating command before awaiting the response', async () => {
    const command = structuredClone(controlCommand)
    const fetcher = vi.fn().mockImplementation(async () => {
      command.requestId = controlCommand.runtime.bootId
      return Response.json(controlReply)
    })
    const client = new HiveAiTextControlClient('https://cloud.test', fetcher)
    expect((await client.status({ ...input, command })).requestId).toBe(controlCommand.requestId)
  })
  it.each([
    'http://cloud.test',
    'https://user:SECRET_CANARY@cloud.test',
    'https://cloud.test/path',
    'https://cloud.test/?token=secret'
  ])('rejects unsafe origin %s', (origin) =>
    expect(() => new HiveAiTextControlClient(origin)).toThrow('invalid_origin')
  )
  it('rejects wrong-request or sensitive metadata replies', async () => {
    for (const reply of [
      { ...controlReply, requestId: controlCommand.runtime.bootId },
      { ...controlReply, key: 'SECRET_CANARY' },
      { ...controlReply, state: 'CANCELLED' }
    ]) {
      const client = new HiveAiTextControlClient('https://cloud.test', async () =>
        Response.json(reply)
      )
      await expect(client.status(input)).rejects.toThrow(/^hive_ai_control_unavailable$/)
    }
  })
})
