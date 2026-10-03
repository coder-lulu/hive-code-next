import { describe, expect, it, vi } from 'vitest'
import { HiveRuntimeCloudAccountClient } from './hive-runtime-cloud-account-client'
import { HiveAccountRuntimeTransport } from './hive-account-runtime-transport'
import { createHiveAccountRuntimeConnectionMaterial } from './hive-account-runtime-connection-material'
import { EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY } from '../../shared/hive-runtime-cloud'
import { HiveAccountRelayPool } from '../../shared/hive-account-relay-pool'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-client'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import { isRecoverableRemoteRuntimeConnectionError } from '../../shared/remote-runtime-client-error-classification'

const uuid = '11111111-1111-4111-8111-111111111111'
describe('account client authorization boundary', () => {
  it('checks cancellation before pool acquisition and passes live signals to the relay pool', async () => {
    const directory = {
      getState: () => EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      getConnectionScope: () => 'account-session',
      createConnection: vi.fn(),
      subscribe: (listener: (state: typeof EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY) => void) => {
        listener({
          ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
          status: 'READY',
          accountId: 'account',
          sessionGeneration: 1
        })
        return vi.fn()
      }
    }
    const transport = new HiveAccountRuntimeTransport(directory, vi.fn())
    const request = vi.spyOn(HiveAccountRelayPool.prototype, 'request').mockResolvedValue({
      id: 'files.upload',
      ok: true,
      result: null,
      _meta: { runtimeId: 'runtime' }
    })
    const claim = { runtimeRecordId: uuid, resourceVersion: 1 } as never
    try {
      const controller = new AbortController()
      controller.abort()
      await expect(
        transport.call(claim, 'files.upload', {}, 1000, undefined, controller.signal)
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(request).not.toHaveBeenCalled()
      expect(directory.createConnection).not.toHaveBeenCalled()
      const live = new AbortController()
      await transport.call(claim, 'files.upload', {}, 1000, undefined, live.signal)
      expect(request).toHaveBeenCalledExactlyOnceWith(
        'files.upload',
        {},
        1000,
        undefined,
        live.signal
      )
    } finally {
      request.mockRestore()
      transport.stop()
    }
  })

  it('preserves cancellation while a Relay request is in flight', async () => {
    const directory = {
      getState: () => EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      getConnectionScope: () => 'account-session',
      createConnection: vi.fn(),
      subscribe: (listener: (state: typeof EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY) => void) => {
        listener({
          ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
          status: 'READY',
          accountId: 'account',
          sessionGeneration: 1
        })
        return vi.fn()
      }
    }
    const controller = new AbortController()
    const transport = new HiveAccountRuntimeTransport(directory, vi.fn())
    const request = vi
      .spyOn(HiveAccountRelayPool.prototype, 'request')
      .mockImplementation(async () => {
        controller.abort()
        throw new Error('connection interrupted')
      })
    const claim = { runtimeRecordId: uuid, resourceVersion: 1 } as never
    try {
      await expect(
        transport.call(claim, 'files.upload', {}, 1_000, undefined, controller.signal)
      ).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      request.mockRestore()
      transport.stop()
    }
  })

  it('preserves a Relay timeout code across the IPC transport boundary', async () => {
    const directory = {
      getState: () => EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      getConnectionScope: () => 'account-session',
      createConnection: vi.fn(),
      subscribe: (listener: (state: typeof EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY) => void) => {
        listener({
          ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
          status: 'READY',
          accountId: 'account',
          sessionGeneration: 1
        })
        return vi.fn()
      }
    }
    const transport = new HiveAccountRuntimeTransport(directory, vi.fn())
    const timeout = new RemoteRuntimeClientError('runtime_timeout', 'Runtime request timed out')
    const request = vi.spyOn(HiveAccountRelayPool.prototype, 'request').mockRejectedValue(timeout)
    const claim = { runtimeRecordId: uuid, resourceVersion: 1 } as never
    try {
      await expect(transport.call(claim, 'browser.goto', {}, 30_000)).rejects.toBe(timeout)
    } finally {
      request.mockRestore()
      transport.stop()
    }
  })

  it('passes the subscription start deadline to the Relay pool', async () => {
    const directory = {
      getState: () => EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      getConnectionScope: () => 'account-session',
      createConnection: vi.fn(),
      subscribe: (listener: (state: typeof EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY) => void) => {
        listener({
          ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
          status: 'READY',
          accountId: 'account',
          sessionGeneration: 1
        })
        return vi.fn()
      }
    }
    const transport = new HiveAccountRuntimeTransport(directory, vi.fn())
    const subscription = {
      close: vi.fn(),
      sendBinary: vi.fn(() => true),
      sendRequest: vi.fn()
    }
    const subscribe = vi
      .spyOn(HiveAccountRelayPool.prototype, 'subscribe')
      .mockResolvedValue(subscription)
    const callbacks = {
      onResponse: vi.fn(),
      onError: vi.fn(),
      onClose: vi.fn()
    }
    const claim = { runtimeRecordId: uuid, resourceVersion: 1 } as never
    try {
      await transport.subscribe(claim, 'browser.screencast', {}, 15_000, callbacks)
      expect(subscribe).toHaveBeenCalledExactlyOnceWith('browser.screencast', {}, callbacks, 15_000)
    } finally {
      subscribe.mockRestore()
      transport.stop()
    }
  })

  it('refuses signed-out RPC without acquiring credentials or opening a socket', async () => {
    const directory = {
      getState: () => EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      getConnectionScope: () => null,
      createConnection: vi.fn(),
      subscribe: (listener: (state: typeof EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY) => void) => {
        listener(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY)
        return vi.fn()
      }
    }
    const socket = vi.fn()
    const transport = new HiveAccountRuntimeTransport(directory, socket)
    const claim = { runtimeRecordId: uuid } as never
    await expect(transport.call(claim, 'status.get', {})).rejects.toMatchObject({
      code: 'remote_runtime_unavailable'
    })
    expect(await transport.getStatus(claim)).toMatchObject({ ok: false })
    expect(directory.createConnection).not.toHaveBeenCalled()
    expect(socket).not.toHaveBeenCalled()
    transport.stop()
  })
  it.each([
    [503, null, 'remote_runtime_unavailable', true],
    [429, 2_000, 'remote_runtime_unavailable', true],
    [403, null, 'unauthorized', false],
    [426, null, 'remote_runtime_upgrade_required', false]
  ] as const)(
    'normalizes connection intent HTTP %s before it crosses IPC',
    async (status, retryAfterMs, code, recoverable) => {
      const directory = {
        getState: () => EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
        getConnectionScope: () => 'account-session',
        createConnection: vi.fn(),
        subscribe: (listener: (state: typeof EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY) => void) => {
          listener({
            ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
            status: 'READY',
            accountId: 'account',
            sessionGeneration: 1
          })
          return vi.fn()
        }
      }
      const transport = new HiveAccountRuntimeTransport(directory, vi.fn())
      const cloudError = new HiveRuntimeCloudRequestError(status, 'relay_unavailable', retryAfterMs)
      const request = vi
        .spyOn(HiveAccountRelayPool.prototype, 'request')
        .mockRejectedValue(cloudError)
      const claim = { runtimeRecordId: uuid, resourceVersion: 1 } as never
      try {
        const failure = await transport
          .call(claim, 'status.get', {})
          .catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(RemoteRuntimeClientError)
        expect(failure).not.toBe(cloudError)
        expect(failure).toMatchObject({ code, status, retryable: recoverable })
        if (retryAfterMs === null) {
          expect(failure).not.toHaveProperty('retryAfterMs')
        } else {
          expect(failure).toHaveProperty('retryAfterMs', retryAfterMs)
        }
        expect(
          isRecoverableRemoteRuntimeConnectionError({
            message: `Error invoking remote method 'runtimeEnvironments:call': ${String(failure)}`
          })
        ).toBe(recoverable)
      } finally {
        request.mockRestore()
        transport.stop()
      }
    }
  )
  it('does not request material for an expired account session', async () => {
    const createConnectionIntent = vi.fn()
    await expect(
      createHiveAccountRuntimeConnectionMaterial({
        runtimeRecordId: uuid,
        expectedResourceVersion: 1,
        authorization: { sessionExpiresAt: 0 } as never,
        client: { createConnectionIntent },
        findEntry: vi.fn(),
        now: () => 1,
        assertAuthorizationCurrent: vi.fn()
      })
    ).rejects.toThrow('signed_out')
    expect(createConnectionIntent).not.toHaveBeenCalled()
  })
  it('calls the current Intent endpoint and accepts its actual 201 status', async () => {
    const response = {
      protocolVersion: 2,
      intentId: uuid,
      ticketId: uuid,
      expiresAt: Date.now() + 30_000,
      cellUrl: 'https://relay.hivekernel.com',
      cellId: 'cell-01',
      cellIncarnationId: uuid,
      assignmentId: uuid,
      assignmentEpoch: 1,
      relayHostId: 'AbCdEf0123456789',
      clientAdmissionToken: `e30.e30.${'A'.repeat(86)}`,
      runtimePublicKeyB64: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
      e2eeFraming: 'hive-relay-e2ee/v2'
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(response), { status: 201 }))
    const client = new HiveRuntimeCloudAccountClient('https://api.hive.example', fetchImpl)
    const body = {
      protocolVersion: 2,
      idempotencyKey: uuid,
      expectedResourceVersion: 1,
      clientKind: 'DESKTOP',
      clientPublicKeyB64: 'A'.repeat(43),
      ticketSecretSha256: 'A'.repeat(43)
    }
    expect(await client.createConnectionIntent(uuid, body, 'test-token', uuid)).toEqual(response)
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.hive.example/hive/v1/runtimes/${uuid}/connection-intents`,
      expect.objectContaining({
        redirect: 'error',
        body: JSON.stringify(body),
        headers: expect.objectContaining({ authorization: 'Bearer test-token' })
      })
    )
  })
})
