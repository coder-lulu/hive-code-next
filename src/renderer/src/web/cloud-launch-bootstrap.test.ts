import { describe, expect, it, vi } from 'vitest'
import { exchangeCloudLaunchCredential } from './cloud-launch-bootstrap'

const credential = {
  ticketId: '123e4567-e89b-42d3-a456-426614174000',
  launchSecret: 'A'.repeat(43)
}

const bootstrap = {
  protocolVersion: 'cloud-launch/v1',
  managedWebSessionId: '223e4567-e89b-42d3-a456-426614174000',
  runtimeSessionId: '323e4567-e89b-42d3-a456-426614174000',
  websocketUrl: 'wss://runtime.example/_hive/runtime',
  serverPublicKeyB64: 'c2VydmVyLXB1YmxpYy1rZXk=',
  sessionToken: 'A'.repeat(43),
  expiresAt: '2026-08-25T12:34:56Z',
  runtimeDisplayMetadata: {
    runtimeRecordId: '423e4567-e89b-42d3-a456-426614174000',
    resourceVersion: 7,
    ownershipEpoch: 8,
    cloudDisplayName: '<备用> 🐝',
    cloudDisplayNameVersion: 2,
    deviceName: '设备'
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

describe('cloud launch bootstrap exchange', () => {
  it('posts the exact credential payload without ambient browser authority', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(bootstrap))

    await expect(
      exchangeCloudLaunchCredential(credential, {
        fetchImpl,
        browserOrigin: 'https://runtime.example'
      })
    ).resolves.toEqual(bootstrap)

    expect(fetchImpl).toHaveBeenCalledWith('/_hive/web-launch/exchange', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ protocolVersion: 'cloud-launch/v1', ...credential }),
      cache: 'no-store',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    })
  })

  it.each([
    ['an unexpected successful status', jsonResponse(bootstrap, { status: 200 })],
    ['a non-success response', jsonResponse({ error: 'gone' }, { status: 410 })],
    [
      'a non-JSON response',
      new Response(JSON.stringify(bootstrap), {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      })
    ],
    ['an extra response field', jsonResponse({ ...bootstrap, deviceToken: 'must-not-cross' })],
    ['missing runtime metadata', jsonResponse({ ...bootstrap, runtimeDisplayMetadata: undefined })],
    [
      'metadata without an explicit nullable alias',
      jsonResponse({
        ...bootstrap,
        runtimeDisplayMetadata: { ...bootstrap.runtimeDisplayMetadata, cloudDisplayName: undefined }
      })
    ],
    [
      'metadata leaking an account field',
      jsonResponse({
        ...bootstrap,
        runtimeDisplayMetadata: { ...bootstrap.runtimeDisplayMetadata, accountId: 'must-not-cross' }
      })
    ],
    [
      'unsafe metadata version',
      jsonResponse({
        ...bootstrap,
        runtimeDisplayMetadata: {
          ...bootstrap.runtimeDisplayMetadata,
          ownershipEpoch: Number.MAX_SAFE_INTEGER + 1
        }
      })
    ],
    [
      'a non-canonical session UUID',
      jsonResponse({ ...bootstrap, runtimeSessionId: 'not-a-uuid' })
    ],
    [
      'an insecure endpoint',
      jsonResponse({ ...bootstrap, websocketUrl: 'ws://runtime.example/socket' })
    ],
    [
      'a cross-origin endpoint',
      jsonResponse({ ...bootstrap, websocketUrl: 'wss://attacker.example/socket' })
    ],
    [
      'an endpoint with a non-default port',
      jsonResponse({ ...bootstrap, websocketUrl: 'wss://runtime.example:8443/socket' })
    ],
    [
      'an endpoint carrying URL state',
      jsonResponse({ ...bootstrap, websocketUrl: 'wss://runtime.example/socket?token=leak' })
    ],
    ['a malformed session token', jsonResponse({ ...bootstrap, sessionToken: 'short' })],
    ['a malformed expiry', jsonResponse({ ...bootstrap, expiresAt: 'tomorrow' })]
  ])('rejects %s', async (_case, response) => {
    const fetchImpl = vi.fn(async () => response)

    await expect(
      exchangeCloudLaunchCredential(credential, {
        fetchImpl,
        browserOrigin: 'https://runtime.example'
      })
    ).rejects.toThrow()
  })
})
