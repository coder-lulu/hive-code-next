import { mkdtempSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ net: { fetch: globalThis.fetch } }))
import { HiveRuntimeRelayHostService } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-host-service'
import { HiveRuntimeRelayCloudClient } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-cloud-client'
import { HiveRuntimeCloudClient } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-client'
import {
  createRuntimeHeartbeatRequest,
  createRuntimeLeaseAcquireRequest
} from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-proof'
import { createHiveRuntimeRelayBindingStore } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-storage'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-lease-context'
import type { HiveRuntimeCloudPresenceService } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type { HiveRuntimeRelayHeartbeatContributor } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-heartbeat-types'
import {
  HiveAccountRelayChannel,
  type HiveAccountRelaySocket
} from '../../../src/shared/hive-account-relay-channel'
import { acquireHiveAccountRelayMaterial } from '../../../src/shared/hive-account-relay-material'
import { RuntimeRpcAccountDispatch } from '../../../src/main/runtime/runtime-rpc/runtime-rpc-account-dispatch'
import { defineMethod, defineStreamingMethod } from '../../../src/main/runtime/rpc/core'
import type { OrcaRuntimeService } from '../../../src/main/runtime/orca-runtime'
import { startAccountRelayCell } from './hive-account-relay-cell-fixture'
import { startAccountRelayBrowser } from './hive-account-relay-browser-fixture'
const origin = process.env.HIVE_RUNTIME_HOST_HTTP_FIXTURE
const pauseCloud = process.env.HIVE_RELAY_CLOUD_PAUSE_TEST === '1'
it.skipIf(!origin)(
  'uses the current client through real TLS Cell, Host, Cloud PostgreSQL and account RPC',
  async () => {
    const started = Date.now()
    const fixtureFetch = async (path: string, body?: object) => {
      const result = await fetch(origin + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (!result.ok) {
        throw new Error(`fixture ${path} failed: ${result.status} ${await result.text()}`)
      }
      return result.json()
    }
    const fixture = await fixtureFetch('/fixture')
    let context = {
      authorityId: fixture.authorityId,
      identity: fixture.identity,
      tuple: fixture.tuple
    } as CurrentHiveRuntimeCloudLeaseContext
    mkdirSync(resolve('.tmp/p4'), { recursive: true })
    const storage = mkdtempSync(join(resolve('.tmp/p4'), 'cell-integration-'))
    createHiveRuntimeRelayBindingStore(join(storage, 'bindings')).write(
      context.tuple.runtimeRecordId,
      fixture.binding
    )
    const raw = nacl.box.keyPair()
    const keypair = { ...raw, publicKeyB64: Buffer.from(raw.publicKey).toString('base64') }
    const browser: { current: Awaited<ReturnType<typeof startAccountRelayBrowser>> | null } = {
      current: null
    }
    const cell = await startAccountRelayCell(
      storage,
      fixture.cell.cellId,
      fixture.relaySigningPublicKey,
      async () => {
        browser.current = await startAccountRelayBrowser(storage, (body) =>
          fixtureFetch('/fixture/intent', body)
        )
        return browser.current.origin
      }
    )
    try {
      await fixtureFetch('/fixture/cell', {
        cellIncarnationId: cell.cellIncarnationId,
        cellOrigin: `https://localhost:${cell.port}`
      })
    } catch (error) {
      await cell.stop()
      await browser.current?.stop()
      throw error
    }
    let contributor: HiveRuntimeRelayHeartbeatContributor | null = null
    let sequence = 2
    let heartbeatTail = Promise.resolve()
    let failure: unknown = null
    let stopped = false
    const observations: string[] = []
    const wireFetch = async (url: string, init: RequestInit) => {
      const response = await fetch(origin + new URL(url).pathname, init)
      observations.push(`${new URL(url).pathname}:${response.status}`)
      if (!response.ok) {
        const error = await response.clone().json()
        failure = new Error(
          `Cloud HTTP ${new URL(url).pathname} ${response.status}: ${error.category ?? error.code ?? error.type ?? 'unknown'}`
        )
      }
      return response
    }
    const cloud = new HiveRuntimeCloudClient('https://hive.example', wireFetch)
    const requestHeartbeat = () => {
      if (stopped) {
        return
      }
      heartbeatTail = heartbeatTail
        .then(async () => {
          const snapshot = contributor?.snapshot(context)
          if (!snapshot) {
            return
          }
          const result = await cloud.heartbeat(
            createRuntimeHeartbeatRequest(
              context.identity,
              {
                bootId: context.tuple.bootId,
                leaseId: context.tuple.heartbeatLeaseId,
                authorityGeneration: context.tuple.authorityGeneration,
                fencingEpoch: context.tuple.fencingEpoch,
                leaseEpoch: context.tuple.leaseEpoch,
                heartbeatSeq: sequence++,
                sourceReportedAt: new Date().toISOString(),
                report: {
                  runtimeVersion: '1.0.0',
                  runtimeProtocolVersion: 3,
                  capabilities: ['runtime-session-control-v1'],
                  readiness: 'READY',
                  readinessReasonCode: 'healthy',
                  startedAt: new Date(started).toISOString(),
                  connectionCapabilities: ['hive-relay', 'ticket-connect-v2'],
                  relayControl: snapshot.relayControl
                }
              },
              { authorityId: context.authorityId }
            )
          )
          expect(result.responseVersion).toBe('runtime-session-control/v1')
          observations.push(
            `heartbeat-ack:${result.ackedSessionTransitionSequence}:${result.sessionTransitionResults?.length}:${result.controlCommands?.length}`
          )
          contributor?.accept(
            context,
            result as Parameters<HiveRuntimeRelayHeartbeatContributor['accept']>[1],
            snapshot.relayControl
          )
        })
        .catch((error) => {
          failure = error
        })
    }
    const leaseListener: { current: (() => void) | null } = { current: null }
    const presence = {
      getCurrentLeaseContext: () => context,
      requestHeartbeat,
      setRelayHeartbeatContributor: (value: HiveRuntimeRelayHeartbeatContributor | null) => {
        contributor = value
      },
      subscribeLeaseContext: (listener: () => void) => {
        leaseListener.current = listener
        listener()
        return () => {
          leaseListener.current = null
        }
      }
    } as unknown as HiveRuntimeCloudPresenceService
    const cleanup = vi.fn()
    const runtime = {
      getRuntimeId: () => context.tuple.runtimeInstanceId,
      cleanupSubscriptionsForConnection: cleanup,
      cancelMobileDictationForConnection: () => {}
    } as unknown as OrcaRuntimeService
    const rpc = new RuntimeRpcAccountDispatch({
      runtime,
      userDataPath: storage,
      methods: [
        defineMethod({
          name: 'fixture.read',
          params: null,
          handler: (_params, ctx) => ({ principal: ctx.clientId })
        }),
        defineStreamingMethod({
          name: 'fixture.stream',
          params: null,
          handler: async (_params, ctx, emit) => {
            emit({ type: 'data', value: 'stream-ready' })
            ctx.sendBinary?.(new Uint8Array([1, 2, 3]))
            await new Promise<void>((done) =>
              ctx.signal?.addEventListener('abort', () => done(), { once: true })
            )
          }
        })
      ]
    })
    const observedWire: string[] = []
    const host = new HiveRuntimeRelayHostService({
      apiBaseUrl: 'https://hive.example',
      storageDirectory: storage,
      presence,
      getKeypair: () => keypair,
      client: new HiveRuntimeRelayCloudClient('https://hive.example', wireFetch),
      createSocket: (url, lease) =>
        new WebSocket(url, {
          ca: cell.ca,
          perMessageDeflate: false,
          headers: lease ? { authorization: `Bearer ${lease}` } : {}
        }),
      attachRpc: (connection) => rpc.attachAccountRuntimeConnection(connection)
    })
    let client: HiveAccountRelayChannel | null = null
    try {
      host.start()
      await vi.waitFor(
        () => {
          if (failure) {
            throw failure
          }
          expect(
            contributor?.snapshot(context)?.advertiseRelay,
            JSON.stringify(observations) + cell.diagnostic()
          ).toBe(true)
        },
        { timeout: 15000 }
      )
      await heartbeatTail
      const material = await acquireHiveAccountRelayMaterial({
        clientKind: 'DESKTOP',
        expectedResourceVersion: 7,
        createIntent: (request) =>
          fixtureFetch('/fixture/intent', {
            secretHash: request.ticketSecretSha256,
            clientPublicKey: request.clientPublicKeyB64
          })
      })
      const secret = Buffer.from(material.inner.ticketSecret).toString('base64url')
      const cat = material.outer.clientAdmissionToken
      client = new HiveAccountRelayChannel({
        material,
        createSocket: (url) => {
          const ws = new WebSocket(url, { ca: cell.ca, perMessageDeflate: false })
          const send = ws.send.bind(ws)
          ws.send = ((data: Parameters<WebSocket['send']>[0]) => {
            observedWire.push(typeof data === 'string' ? data : '[binary]')
            send(data)
          }) as WebSocket['send']
          return ws as unknown as HiveAccountRelaySocket
        }
      })
      await client.connect()
      expect((await fixtureFetch('/fixture/status')).status).toBe('ACTIVE')
      const response = await client.request({ id: 'read', method: 'fixture.read' })
      expect(response).toMatchObject({
        ok: true,
        result: { principal: expect.stringMatching(/^account-runtime:/) }
      })
      if (!response.ok) {
        throw new Error('Initial Relay RPC failed')
      }
      const rpcLatencies = await Promise.all(
        Array.from({ length: 20 }, async (_, index) => {
          const id = `concurrent-read-${index}`
          const requestStarted = performance.now()
          const result = await client!.request({ id, method: 'fixture.read' })
          expect(result).toMatchObject({ id, ok: true, result: response.result })
          return performance.now() - requestStarted
        })
      )
      rpcLatencies.sort((left, right) => left - right)
      // Local acceptance target for a 20-request burst, independent of Cell forwarding RTT.
      expect(rpcLatencies[18]).toBeLessThan(1000)
      writeFileSync(
        join(storage, 'rpc-latency.json'),
        JSON.stringify({
          requests: 20,
          errors: 0,
          p95Ms: rpcLatencies[18],
          maxMs: rpcLatencies[19]
        })
      )
      const onResponse = vi.fn(),
        onBinary = vi.fn(),
        onClose = vi.fn()
      client.subscribe(
        { id: 'stream', method: 'fixture.stream' },
        { onResponse, onBinary, onClose }
      )
      await vi.waitFor(() => {
        expect(onResponse).toHaveBeenCalled()
        expect(onBinary).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
      })
      expect(observedWire.join('')).not.toContain(secret)
      expect(JSON.parse(observedWire[0]!)).toEqual({
        type: 'relay-auth',
        v: 2,
        clientAdmissionToken: cat,
        clientPublicKeyB64: Buffer.from(material.clientKeyPair.publicKey).toString('base64url')
      })
      await browser.current!.run()
      if (pauseCloud) {
        const acquire = () =>
          acquireHiveAccountRelayMaterial({
            clientKind: 'DESKTOP',
            expectedResourceVersion: 7,
            createIntent: (request) =>
              fixtureFetch('/fixture/intent', {
                secretHash: request.ticketSecretSha256,
                clientPublicKey: request.clientPublicKeyB64
              })
          })
        const unusedMaterial = await acquire()
        const outageStarted = performance.now()
        await fixtureFetch('/fixture/cloud-pause', {})
        await vi.waitFor(
          async () => {
            await expect(
              fetch(`${origin}/fixture`, { signal: AbortSignal.timeout(2000) })
            ).rejects.toThrow()
          },
          { timeout: 5000 }
        )
        await vi.waitFor(() => expect(client!.isClosed).toBe(true), { timeout: 120_000 })
        const authorityLostMs = performance.now() - outageStarted
        expect(authorityLostMs).toBeLessThan(120_000)
        await expect(client.request({ id: 'outage', method: 'fixture.read' })).rejects.toThrow()
        await vi.waitFor(() => expect(host.getStatus()).toBe('connecting'), {
          timeout: 120_000 - authorityLostMs
        })
        const controlLostMs = performance.now() - outageStarted
        expect(controlLostMs).toBeLessThan(120_000)
        await vi.waitFor(
          async () => {
            expect(
              (await fetch(`${origin}/fixture`, { signal: AbortSignal.timeout(2000) })).ok
            ).toBe(true)
          },
          { timeout: 135_000, interval: 1000 }
        )
        // A fresh observation of the still-running local Cell replaces the expired catalog observation.
        await fixtureFetch('/fixture/cell', {
          cellIncarnationId: cell.cellIncarnationId,
          cellOrigin: `https://localhost:${cell.port}`
        })
        await heartbeatTail
        const bootId = randomUUID()
        const lease = await cloud.acquireLease(
          createRuntimeLeaseAcquireRequest(
            context.identity,
            {
              bootId,
              expectedAuthorityGeneration: context.tuple.authorityGeneration,
              expectedLeaseEpoch: context.tuple.leaseEpoch,
              expectedFencingEpoch: context.tuple.fencingEpoch
            },
            { authorityId: context.authorityId }
          )
        )
        context = {
          ...context,
          tuple: {
            ...context.tuple,
            bootId,
            heartbeatLeaseId: lease.leaseId,
            authorityGeneration: lease.authorityGeneration,
            leaseEpoch: lease.leaseEpoch,
            fencingEpoch: lease.fencingEpoch
          }
        }
        sequence = 1
        leaseListener.current?.()
        await vi.waitFor(
          () =>
            expect(host.getStatus(), JSON.stringify(observations.slice(-12))).toBe('registered'),
          { timeout: 45_000 }
        )
        await heartbeatTail
        const createSocket = (url: string) =>
          new WebSocket(url, {
            ca: cell.ca,
            perMessageDeflate: false
          }) as unknown as HiveAccountRelaySocket
        const stale = new HiveAccountRelayChannel({ material: unusedMaterial, createSocket })
        try {
          await expect(stale.connect()).rejects.toThrow('Relay admission expired')
        } finally {
          stale.close()
        }
        expect(client.isClosed).toBe(true)
        client = new HiveAccountRelayChannel({ material: await acquire(), createSocket })
        await client.connect()
        expect(await client.request({ id: 'recovered', method: 'fixture.read' })).toMatchObject({
          ok: true,
          result: { principal: expect.stringMatching(/^account-runtime:/) }
        })
        writeFileSync(
          join(storage, 'cloud-recovery.json'),
          JSON.stringify({
            pauseMillis: 125_000,
            authorityLostMs,
            controlLostMs,
            expiredMaterialRejectedLocally: true,
            oldChannelStillClosed: true,
            freshRpcSucceeded: true
          })
        )
      }
      await fixtureFetch('/fixture/revoke', {})
      requestHeartbeat()
      await vi.waitFor(() => expect(client!.isClosed).toBe(true), { timeout: 8000 })
      await heartbeatTail
      await browser.current!.assertRevoked()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(cleanup).toHaveBeenCalledTimes(pauseCloud ? 4 : 3)
      await vi.waitFor(
        async () => expect((await fixtureFetch('/fixture/status')).status).toBe('REVOKED'),
        { timeout: 5000 }
      )
      const persisted = (directory: string): string =>
        readdirSync(directory, { withFileTypes: true })
          .map((entry) =>
            entry.isDirectory()
              ? persisted(join(directory, entry.name))
              : readFileSync(join(directory, entry.name), 'utf8')
          )
          .join('')
      const diagnostics = persisted(storage) + cell.diagnostic()
      expect(diagnostics).not.toContain(secret)
      expect(diagnostics).not.toContain(cat)
      expect(
        await fixtureFetch('/fixture/verify-secrets', {
          canaries: [secret, cat, context.identity.privateKeyPkcs8]
        })
      ).toEqual({ canaryMatches: 0 })
    } finally {
      stopped = true
      client?.close()
      await browser.current?.stop()
      await host.stop()
      await cell.stop()
      await heartbeatTail
    }
  },
  pauseCloud ? 270_000 : 60_000
)
