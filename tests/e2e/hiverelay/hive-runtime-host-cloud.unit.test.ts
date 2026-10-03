import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ net: { fetch: globalThis.fetch } }))
import { ProgrammableHiveRelayMockCell } from './programmable-mock-cell'
import type { ProgrammableMockCellOptions } from './hiverelay-mock-cell-state'
import type { HiveRelayBinding } from './hiverelay-test-wire'
import { HiveRuntimeRelayHostService } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-host-service'
import { HiveRuntimeRelayCloudClient } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-cloud-client'
import { HiveRuntimeCloudClient } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-client'
import { createRuntimeHeartbeatRequest } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-proof'
import { createHiveRuntimeRelayBindingStore } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-storage'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-lease-context'
import type { HiveRuntimeCloudPresenceService } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type { HiveRuntimeRelayHeartbeatContributor } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-heartbeat-types'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake,
  type MobileE2EEV2Hello
} from '../../../src/shared/mobile-e2ee-v2-contract'
import {
  sealMobileE2EEV2Frame,
  openMobileE2EEV2Frame
} from '../../../src/shared/mobile-e2ee-v2-framing'
import { deriveSharedKey } from '../../../src/main/runtime/rpc/e2ee-crypto'
import { deriveMobileE2EEV2KeySchedule } from '../../../src/main/runtime/rpc/mobile-e2ee-v2-key-schedule'

const origin = process.env.HIVE_RUNTIME_HOST_HTTP_FIXTURE
it.skipIf(!origin)(
  'commits actual Host consume/ACTIVATE and revokes over real Cloud HTTP and PostgreSQL',
  async () => {
    const started = Date.now()
    const fixtureFetch = async (path: string, body?: Record<string, unknown>) => {
      const result = await fetch(origin + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (!result.ok) {
        throw new Error(`fixture ${path} failed: ${result.status}`)
      }
      return result.json()
    }
    const fixture = await fixtureFetch('/fixture')
    const context = {
      authorityId: fixture.authorityId,
      identity: fixture.identity,
      tuple: fixture.tuple
    } as CurrentHiveRuntimeCloudLeaseContext
    const storage = mkdtempSync(join(tmpdir(), 'hive-host-http-'))
    createHiveRuntimeRelayBindingStore(join(storage, 'bindings')).write(
      context.tuple.runtimeRecordId,
      fixture.binding
    )
    const raw = nacl.box.keyPair()
    const keypair = { ...raw, publicKeyB64: Buffer.from(raw.publicKey).toString('base64') }
    const mockBinding: HiveRelayBinding = {
      ...fixture.cell,
      runtimeId: context.tuple.runtimeInstanceId,
      runtimeBootId: context.tuple.bootId,
      authorityGeneration: context.tuple.authorityGeneration,
      fencingEpoch: context.tuple.fencingEpoch,
      leaseEpoch: context.tuple.leaseEpoch,
      assignmentId: '11111111-1111-4111-8111-111111111111',
      assignmentEpoch: 1,
      controlGeneration: 1,
      relayHostId: createHash('sha256').update(raw.publicKey).digest('base64url').slice(0, 16)
    }
    delete (mockBinding as unknown as Record<string, unknown>).cellOrigin
    let cellNow = Date.now()
    const cellOptions: ProgrammableMockCellOptions = {
      cellOrigin: fixture.cell.cellOrigin,
      controlLease: 'pending',
      binding: mockBinding,
      admissionGrants: [],
      now: () => cellNow
    }
    const cell = new ProgrammableHiveRelayMockCell(cellOptions)
    await cell.start()
    let contributor: HiveRuntimeRelayHeartbeatContributor | null = null
    const currentSnapshot = () => contributor?.snapshot(context)
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
    const presence = {
      getCurrentLeaseContext: () => context,
      requestHeartbeat,
      setRelayHeartbeatContributor: (value: HiveRuntimeRelayHeartbeatContributor | null) => {
        contributor = value
      },
      subscribeLeaseContext: (listener: () => void) => {
        listener()
        return () => {}
      }
    } as unknown as HiveRuntimeCloudPresenceService
    let attached = false
    let detached = false
    const host = new HiveRuntimeRelayHostService({
      apiBaseUrl: 'https://hive.example',
      storageDirectory: storage,
      presence,
      getKeypair: () => keypair,
      client: new HiveRuntimeRelayCloudClient('https://hive.example', wireFetch),
      createSocket: (url, lease) => {
        if (lease) {
          const claims = JSON.parse(Buffer.from(lease.split('.')[1], 'base64url').toString())
          for (const key of Object.keys(mockBinding)) {
            ;(mockBinding as unknown as Record<string, unknown>)[key] =
              claims[key] ?? (mockBinding as unknown as Record<string, unknown>)[key]
          }
          cellOptions.controlLease = lease
          cellNow = claims.exp * 1000 - 120000
        }
        return new WebSocket(cell.baseUrl.replace('http:', 'ws:') + new URL(url).pathname, {
          headers: lease ? { authorization: `Bearer ${lease}` } : {},
          perMessageDeflate: false
        })
      },
      attachRpc: (connection) => {
        attached = true
        connection.channel.onMessage((_raw, reply) => {
          if (connection.revalidate(true)) {
            reply(JSON.stringify({ id: 'probe', result: 'ready' }))
          }
        })
        return () => {
          detached = true
        }
      }
    })
    let phase = 'host startup'
    const waitEvent = (socket: WebSocket, event: string) =>
      once(socket, event, { signal: AbortSignal.timeout(8000) }).catch(() => {
        throw new Error(
          `phase ${phase}: ${JSON.stringify(observations)}; events ${JSON.stringify(cell.events)}; ${failure instanceof Error ? failure.message : 'no HTTP error'}`
        )
      })
    let client: WebSocket | null = null
    try {
      host.start()
      await vi.waitFor(
        () => {
          if (failure) {
            throw failure
          }
          expect(contributor?.snapshot(context)?.advertiseRelay, JSON.stringify(observations)).toBe(
            true
          )
        },
        { timeout: 15000 }
      )
      await heartbeatTail
      if (failure) {
        throw failure
      }
      const clientKeys = nacl.box.keyPair()
      const secret = randomBytes(32).toString('base64url')
      const intent = await fixtureFetch('/fixture/intent', {
        secretHash: createHash('sha256')
          .update(Buffer.from(secret, 'base64url'))
          .digest('base64url'),
        clientPublicKey: Buffer.from(clientKeys.publicKey).toString('base64url')
      })
      expect(currentSnapshot()?.advertiseRelay, JSON.stringify(observations)).toBe(true)
      cell.registerAdmissionGrant({
        token: intent.clientAdmissionToken,
        binding: { ...mockBinding },
        origin: null,
        expiresAtMs: intent.expiresAt,
        clientPublicKeyB64: Buffer.from(clientKeys.publicKey).toString('base64url'),
        clientKeyHash: createHash('sha256').update(clientKeys.publicKey).digest('base64url'),
        intentId: intent.intentId
      })
      phase = 'cell admission'
      client = new WebSocket(
        `${cell.baseUrl.replace('http:', 'ws:')}/v1/connect/${mockBinding.relayHostId}`
      )
      client.on('close', (code, reason) => {
        const value = reason.toString()
        observations.push(
          `client-close:${code}:${/^[A-Z_]{1,64}$/.test(value) ? value : 'unclassified'}`
        )
      })
      await waitEvent(client, 'open')
      let message = waitEvent(client, 'message')
      client.send(
        JSON.stringify({
          type: 'relay-auth',
          v: 2,
          clientAdmissionToken: intent.clientAdmissionToken,
          clientPublicKeyB64: Buffer.from(clientKeys.publicKey).toString('base64url')
        })
      )
      await message
      phase = 'E2EE hello'
      const hello: MobileE2EEV2Hello = {
        type: 'e2ee_hello',
        v: 2,
        clientPublicKeyB64: Buffer.from(clientKeys.publicKey).toString('base64'),
        clientNonceB64: randomBytes(32).toString('base64'),
        capabilities: { framing: [2], payloadKinds: ['text', 'binary'] },
        context: {
          protocol: 'orca-mobile-e2ee',
          initiator: 'mobile',
          responder: 'desktop',
          transport: 'relay',
          relayHostId: mockBinding.relayHostId
        }
      }
      message = waitEvent(client, 'message')
      client.send(JSON.stringify(hello))
      const [readyBytes] = await message
      const handshake = validateMobileE2EEV2Handshake(hello, JSON.parse(readyBytes.toString()))!
      expect(handshake).not.toBeNull()
      const schedule = deriveMobileE2EEV2KeySchedule({
        sharedSecret: deriveSharedKey(clientKeys.secretKey, raw.publicKey),
        transcript: encodeMobileE2EEV2Transcript(handshake),
        clientNonce: handshake.clientNonce,
        desktopNonce: handshake.desktopNonce
      })
      const seal = (body: Record<string, unknown>, counter: bigint) =>
        Buffer.from(
          sealMobileE2EEV2Frame({
            payload: Buffer.from(JSON.stringify(body)),
            key: schedule.mobileToDesktopKey,
            sessionId: schedule.sessionId,
            direction: 'mobile-to-desktop',
            payloadKind: 'text',
            counter
          })
        ).toString('base64')
      phase = 'Account activation'
      expect(attached).toBe(false)
      message = waitEvent(client, 'message')
      client.send(
        seal(
          {
            type: 'e2ee_auth',
            principalKind: 'account_runtime_session',
            ticketId: intent.ticketId,
            ticketSecret: secret
          },
          0n
        )
      )
      const [authenticated] = await message
      const plaintext = openMobileE2EEV2Frame({
        frame: Buffer.from(authenticated.toString(), 'base64'),
        key: schedule.desktopToMobileKey,
        sessionId: schedule.sessionId,
        direction: 'desktop-to-mobile',
        payloadKind: 'text',
        expectedCounter: 0n
      })
      expect(JSON.parse(Buffer.from(plaintext!).toString()).type).toBe('e2ee_authenticated')
      expect(attached).toBe(true)
      expect((await fixtureFetch('/fixture/status')).status).toBe('ACTIVE')
      phase = 'RPC reply'
      message = waitEvent(client, 'message')
      client.send(seal({ id: 'probe', method: 'runtime.info', params: {} }, 1n))
      const [rpcReply] = await message
      const reply = openMobileE2EEV2Frame({
        frame: Buffer.from(rpcReply.toString(), 'base64'),
        key: schedule.desktopToMobileKey,
        sessionId: schedule.sessionId,
        direction: 'desktop-to-mobile',
        payloadKind: 'text',
        expectedCounter: 1n
      })
      expect(JSON.parse(Buffer.from(reply!).toString())).toEqual({ id: 'probe', result: 'ready' })
      phase = 'revocation'
      await fixtureFetch('/fixture/revoke', {})
      const closed = waitEvent(client, 'close')
      requestHeartbeat()
      await closed
      await heartbeatTail
      await vi.waitFor(
        async () => expect((await fixtureFetch('/fixture/status')).status).toBe('REVOKED'),
        { timeout: 5000 }
      )
      expect(detached).toBe(true)
      const persisted = (directory: string): string =>
        readdirSync(directory, { withFileTypes: true })
          .map((entry) =>
            entry.isDirectory()
              ? persisted(join(directory, entry.name))
              : readFileSync(join(directory, entry.name), 'utf8')
          )
          .join('')
      const diagnostic = persisted(storage) + JSON.stringify(cell.events)
      for (const canary of [
        secret,
        intent.clientAdmissionToken,
        context.identity.privateKeyPkcs8
      ]) {
        expect(diagnostic.includes(canary)).toBe(false)
      }
      expect(
        await fixtureFetch('/fixture/verify-secrets', {
          canaries: [
            secret,
            intent.clientAdmissionToken,
            context.identity.privateKeyPkcs8,
            cellOptions.controlLease
          ]
        })
      ).toEqual({ canaryMatches: 0 })
      expect(Date.now() - started).toBeLessThan(30000)
    } finally {
      stopped = true
      client?.terminate()
      await host.stop()
      await cell.stop()
      await heartbeatTail
      rmSync(storage, { recursive: true, force: true })
    }
  },
  45000
)
