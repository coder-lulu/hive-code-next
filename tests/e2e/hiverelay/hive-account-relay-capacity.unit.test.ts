import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import { z } from 'zod'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ net: { fetch: globalThis.fetch } }))
import { HiveRuntimeCloudClient } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-client'
import { HiveRuntimeCloudPresenceService } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-presence-service'
import { defaultPresenceDependencies } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-presence-support'
import { createHiveRuntimeCloudReport } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-report'
import { getOrCreateHiveRuntimeCloudServiceIdentity } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-identity-store'
import {
  readHiveRuntimeCloudServiceRegistrationState,
  saveHiveRuntimeCloudServiceRegistrationState
} from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-state-store'
import { writeHiveRuntimeServiceOwnedJson } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-service-owned-json'
import { HiveRuntimeRelayHostService } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-host-service'
import { HiveRuntimeRelayCloudClient } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-cloud-client'
import type { HiveAccountRelayChannel } from '../../../src/shared/hive-account-relay-channel'
import { RuntimeRpcAccountDispatch } from '../../../src/main/runtime/runtime-rpc/runtime-rpc-account-dispatch'
import { defineMethod } from '../../../src/main/runtime/rpc/core'
import type { OrcaRuntimeService } from '../../../src/main/runtime/orca-runtime'
import { startAccountRelayCell } from './hive-account-relay-cell-fixture'
import { createCapacityClientHarness } from './hive-account-relay-capacity-client'
import { createCapacityFixtureFetch } from './hive-account-relay-capacity-fixture-client'
import { runFenceTimeoutScenario } from './hive-account-relay-fence-capacity'
import { FenceFaultInjector } from './hive-account-relay-fence-fault'
import {
  observeCapacitySocket,
  safeFailureSymbols,
  capacityFailure,
  assertHeartbeatBurst,
  observeRevocationPending,
  assertWorkerConvergence,
  waitForClosed,
  assertRecoveredLeases,
  assertInflightCoverage,
  assertHeartbeatSequence,
  assertOldTerminalSessions,
  capacityDiagnostic,
  assertRuntimeSessions,
  assertCapacityCellCounts,
  type RuntimeFixture,
  type CloudStatus
} from './hive-account-relay-capacity-support'
const origin = process.env.HIVE_RUNTIME_CAPACITY_HTTP_FIXTURE
const runtimeCount = 30
const scenario = process.env.HIVE_RELAY_CAPACITY_SCENARIO ?? 'ordered-close'
const simultaneousClose = scenario === 'simultaneous-close' || scenario === 'inflight-close'
const fenceTimeout = scenario === 'fence-timeout'
const durationSeconds = fenceTimeout ? 5 : simultaneousClose ? 60 : 305
const sleep = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds))
it.skipIf(!origin)(
  'keeps 30 isolated Runtime service compositions and 30 encrypted account clients correct across two Cells',
  async () => {
    expect(['ordered-close', 'simultaneous-close', 'inflight-close', 'fence-timeout']).toContain(
      scenario
    )
    const bridge = new URL(origin!)
    expect(bridge.protocol).toBe('http:')
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(bridge.hostname)
    const storageRoot = resolve('.tmp/p7-capacity')
    mkdirSync(storageRoot, { recursive: true })
    const storage = mkdtempSync(join(storageRoot, 'account-path-'))
    const evidence =
      process.env.HIVE_RELAY_CAPACITY_EVIDENCE_DIR ??
      join(storageRoot, `evidence-${basename(storage)}`)
    const evidenceFromStorage = relative(storage, resolve(evidence))
    expect(
      isAbsolute(evidenceFromStorage) ||
        evidenceFromStorage === '..' ||
        evidenceFromStorage.startsWith(`..${sep}`)
    ).toBe(true)
    mkdirSync(evidence, { recursive: true })
    const fixtureFetch = createCapacityFixtureFetch(bridge)
    const fixture = await fixtureFetch<{
      authorityId: string
      ownerAccountId: string
      relaySigningPublicKey: string
      runtimes: RuntimeFixture[]
      cells: { cellId: string }[]
    }>('/fixture')
    expect(fixture.runtimes).toHaveLength(runtimeCount)
    expect(new Set(fixture.runtimes.map((r) => r.identity.runtimeInstanceId)).size).toBe(
      runtimeCount
    )
    expect(new Set(fixture.runtimes.map((r) => r.identity.publicKey)).size).toBe(runtimeCount)
    expect(fixture.cells).toHaveLength(2)
    const cells: Awaited<ReturnType<typeof startAccountRelayCell>>[] = []
    const services: {
      item: RuntimeFixture
      presence: HiveRuntimeCloudPresenceService
      host: HiveRuntimeRelayHostService
      client: HiveAccountRelayChannel | null
      heartbeatResponses: number
      refreshResponses: number
      heartbeatSequences: number[]
    }[] = []
    const failures: string[] = []
    const recoveryResponses: {
      runtimeId: string
      status: number
      requestStartedAt: number
      receivedAt: number
      retryAfter: string | null
      symbols: string
    }[] = []
    const leaseEvidence: Record<string, unknown>[] = []
    const fenceEvidence: Record<string, unknown>[] = []
    const fenceTargetRuntimeId = fenceTimeout
      ? fixture.runtimes[0]!.identity.runtimeInstanceId
      : null
    const fenceFault = fenceTargetRuntimeId ? new FenceFaultInjector(fenceTargetRuntimeId) : null
    let terminalStatus: CloudStatus | undefined
    let recoveryStartedAt = 0
    let recoveryElapsedMs = 0
    let recoveredSteadyElapsedMs = 0
    const lifecycle: Record<string, unknown>[] = []
    const latestHeartbeat = new Map<string, Record<string, unknown>>()
    const recordLifecycle = (event: Record<string, unknown>) => {
      if (lifecycle.length < 10_000) {
        lifecycle.push({ at: Date.now(), monotonicMs: performance.now(), ...event })
      }
    }
    const observedSocket = (socket: WebSocket, runtimeId: string, role: string) =>
      observeCapacitySocket(socket, runtimeId, role, recordLifecycle, (id) => ({
        host: services
          .find((service) => service.item.identity.runtimeInstanceId === id)
          ?.host.getStatus(),
        presence: services
          .find((service) => service.item.identity.runtimeInstanceId === id)
          ?.presence.getState(),
        latestHeartbeat: latestHeartbeat.get(id)
      }))
    const latencies: number[] = []
    let observationTimer: ReturnType<typeof setInterval> | undefined
    let observationTail = Promise.resolve()
    let requests = 0
    let steadyElapsedMs = 0
    let oldSessions: string[] = []
    let newSessions: string[] = []
    let connectedStatus: CloudStatus | undefined
    let reconnectedStatus: CloudStatus | undefined
    let finalStatus: CloudStatus | undefined
    const cellObservations: unknown[] = []
    let passed = false
    let phase = 'setup'
    let mainFailure: { name: string; message: string; location: string[] } | null = null
    const startedAt = new Date().toISOString()
    try {
      for (const item of fixture.cells) {
        const directory = join(storage, item.cellId)
        mkdirSync(directory)
        cells.push(
          await startAccountRelayCell(
            directory,
            item.cellId,
            fixture.relaySigningPublicKey,
            undefined,
            {
              lifetimeMs: 1_100_000,
              authenticatedSlots: 384
            },
            fenceTimeout
          )
        )
      }
      writeFileSync(
        join(evidence, 'cell-processes.json'),
        JSON.stringify({ cells: cells.map(({ cellId, processPid }) => ({ cellId, processPid })) })
      )
      const observeCells = async () => {
        for (const cell of cells) {
          const observation = cell.readObservation()
          expect(Date.now() - observation.observedAt).toBeLessThan(5_000)
          expect(observation.status.publicReady).toBe(true)
          expect(observation.status.cellIncarnationId).toBe(cell.cellIncarnationId)
          await fixtureFetch('/fixture/cell', {
            cellId: cell.cellId,
            cellIncarnationId: cell.cellIncarnationId,
            cellOrigin: `https://localhost:${cell.port}`
          })
        }
      }
      await vi.waitFor(observeCells, { timeout: 15_000, interval: 250 })
      if (fenceTimeout) {
        for (const cell of cells) {
          expect(cell.privateOrigin).toMatch(/^https:\/\/localhost:\d+$/)
          expect(cell.privatePki).toBeDefined()
          await fixtureFetch('/fixture/private-cell', {
            cellId: cell.cellId,
            cellIncarnationId: cell.cellIncarnationId,
            privateOrigin: cell.privateOrigin,
            caPemPath: cell.privatePki!.caPemPath,
            clientPkcs12Path: cell.privatePki!.clientPkcs12Path
          })
        }
      }
      observationTimer = setInterval(() => {
        observationTail = observationTail.then(observeCells).catch((error: unknown) => {
          failures.push(`Cell observation: ${String(error)}`)
        })
      }, 10_000)
      const ca = cells.map((cell) => cell.ca)
      for (const item of fixture.runtimes) {
        const directory = join(storage, item.identity.runtimeInstanceId)
        mkdirSync(directory)
        expect(
          writeHiveRuntimeServiceOwnedJson(
            join(directory, 'hive-runtime-cloud-service', 'runtime-identity.v1.json'),
            item.identity
          )
        ).toBe(true)
        expect(
          saveHiveRuntimeCloudServiceRegistrationState(directory, {
            schemaVersion: 1,
            status: 'CLAIMED',
            authorityId: fixture.authorityId,
            ownerAccountId: fixture.ownerAccountId,
            runtimeRecordId: item.tuple.runtimeRecordId,
            resourceVersion: item.resourceVersion,
            authorityGeneration: item.tuple.authorityGeneration,
            fencingEpoch: item.tuple.fencingEpoch,
            latestLeaseEpoch: item.tuple.leaseEpoch
          })
        ).toBe(true)
        let heartbeatResponses = 0
        let refreshResponses = 0
        const heartbeatSequences: number[] = []
        const wireFetch = async (url: string, init: RequestInit) => {
          const path = new URL(url).pathname
          const requestStartedAt = Date.now()
          const requestPhase = phase
          if (path === '/hive/v1/runtime-heartbeats') {
            const previousRejection = recoveryResponses.findLast(
              (event) => event.runtimeId === item.identity.runtimeInstanceId && event.status === 503
            )
            if (
              previousRejection &&
              requestStartedAt <
                previousRejection.receivedAt + Number(previousRejection.retryAfter) * 1000 - 1
            ) {
              failures.push(`${item.identity.runtimeInstanceId}: heartbeat violated Retry-After`)
            }
            recordLifecycle({
              event: 'heartbeat-request',
              runtimeId: item.identity.runtimeInstanceId,
              requestStartedAt,
              phase: requestPhase
            })
          }
          let response = await fetch(new URL(path, bridge), init)
          response =
            (await fenceFault?.hideStaleRefresh(
              item.identity.runtimeInstanceId,
              path,
              response,
              recordLifecycle
            )) ?? response
          if (!response.ok) {
            const symbols = await safeFailureSymbols(response)
            const code = JSON.parse(symbols || '{}').code
            const retryAfter = response.headers.get('retry-after')
            const expectedRecovery =
              simultaneousClose &&
              requestPhase === 'simultaneous-recovery' &&
              path === '/hive/v1/runtime-heartbeats' &&
              ((response.status === 503 && code === 'RELAY_UNAVAILABLE' && retryAfter === '1') ||
                (response.status === 410 &&
                  code === 'STALE_BINDING' &&
                  recoveryResponses.some(
                    (event) =>
                      event.runtimeId === item.identity.runtimeInstanceId && event.status === 503
                  )))
            if (expectedRecovery) {
              recoveryResponses.push({
                runtimeId: item.identity.runtimeInstanceId,
                status: response.status,
                requestStartedAt,
                receivedAt: Date.now(),
                retryAfter,
                symbols
              })
              if (recoveryResponses.length > runtimeCount * 3) {
                failures.push('Recovery response budget exceeded')
              }
            } else {
              failures.push(
                `${item.identity.runtimeInstanceId} ${path}: HTTP ${response.status} ${symbols}`
              )
            }
            recordLifecycle({
              event: 'http-failure',
              runtimeId: item.identity.runtimeInstanceId,
              requestStartedAt,
              receivedAt: Date.now(),
              path,
              status: response.status,
              symbols,
              retryAfter,
              expectedRecovery,
              phase: requestPhase
            })
          } else if (path === '/hive/v1/runtime-heartbeats') {
            heartbeatResponses += 1
            const heartbeat = (await response.clone().json()) as Record<string, unknown>
            heartbeatSequences.push(Number(heartbeat.acceptedHeartbeatSeq))
            const request = JSON.parse(String(init.body))
            const snapshot: Record<string, unknown> = {
              event: 'heartbeat-response',
              runtimeId: item.identity.runtimeInstanceId,
              requestStartedAt,
              receivedAt: Date.now(),
              sentHeartbeatSeq: request.heartbeatSeq,
              acceptedHeartbeatSeq: heartbeat.acceptedHeartbeatSeq,
              heartbeatLeaseId: request.leaseId,
              bootId: request.bootId,
              leaseEpoch: request.leaseEpoch,
              sessionAuthorityUntil: heartbeat.sessionAuthorityUntil,
              leaseExpiresAt: heartbeat.leaseExpiresAt,
              controlConnectionAcknowledged:
                request.report?.relayControl?.controlConnectionAcknowledged,
              controlGeneration: request.report?.relayControl?.controlGeneration,
              ackedSessionTransitionSequence: heartbeat.ackedSessionTransitionSequence,
              host: services.find((service) => service.item === item)?.host.getStatus(),
              presence: services.find((service) => service.item === item)?.presence.getState()
            }
            latestHeartbeat.set(item.identity.runtimeInstanceId, snapshot)
            assertHeartbeatSequence(lifecycle, snapshot)
            recordLifecycle(snapshot)
            return (
              fenceFault?.hideCommands(
                item.identity.runtimeInstanceId,
                response,
                heartbeat,
                recordLifecycle
              ) ?? response
            )
          } else if (path.endsWith('/relay/control-leases/refresh')) {
            refreshResponses += 1
            const refreshed = (await response.clone().json()) as Record<string, unknown>
            recordLifecycle({
              event: 'control-refresh-response',
              runtimeId: item.identity.runtimeInstanceId,
              requestStartedAt,
              receivedAt: Date.now(),
              controlLeaseExpiresAt: refreshed.controlLeaseExpiresAt,
              controlGeneration: refreshed.controlGeneration,
              refreshResponses
            })
          }
          await fenceFault?.captureAssignment(item.identity.runtimeInstanceId, path, response)
          return response
        }
        const presence = new HiveRuntimeCloudPresenceService(
          { enabled: true, apiBaseUrl: 'https://hive.example' },
          directory,
          {
            getReport: () =>
              createHiveRuntimeCloudReport(
                {
                  getStartedAt: () => Date.parse(startedAt),
                  getStatus: () => ({ graphStatus: 'ready' })
                },
                '1.0.0'
              )
          },
          {
            ...defaultPresenceDependencies,
            createClient: (url) => new HiveRuntimeCloudClient(url, wireFetch),
            loadIdentity: getOrCreateHiveRuntimeCloudServiceIdentity,
            readState: readHiveRuntimeCloudServiceRegistrationState,
            saveState: saveHiveRuntimeCloudServiceRegistrationState
          }
        )
        const runtime = {
          getRuntimeId: () => item.identity.runtimeInstanceId,
          cleanupSubscriptionsForConnection: () => {},
          cancelMobileDictationForConnection: () => {}
        } as unknown as OrcaRuntimeService
        const dispatch = new RuntimeRpcAccountDispatch({
          runtime,
          userDataPath: directory,
          methods: [
            defineMethod({
              name: 'capacity.echo',
              params: z.object({
                runtimeRecordId: z.string().uuid(),
                nonce: z.string(),
                tick: z.number().int()
              }),
              handler: (params, context) => {
                if (params.runtimeRecordId !== item.tuple.runtimeRecordId) {
                  throw new Error('Cross-Runtime RPC routing')
                }
                return {
                  ...params,
                  runtimeInstanceId: item.identity.runtimeInstanceId,
                  principal: context.clientId,
                  runtimeSessionId: context.authenticatedAccountRuntimeSessionId
                }
              }
            })
          ]
        })
        const raw = nacl.box.keyPair()
        const keypair = { ...raw, publicKeyB64: Buffer.from(raw.publicKey).toString('base64') }
        const host = new HiveRuntimeRelayHostService({
          apiBaseUrl: 'https://hive.example',
          storageDirectory: directory,
          presence,
          getKeypair: () => keypair,
          client: new HiveRuntimeRelayCloudClient('https://hive.example', wireFetch),
          createSocket: (url, lease) =>
            observedSocket(
              new WebSocket(url, {
                ca,
                perMessageDeflate: false,
                headers: lease ? { authorization: `Bearer ${lease}` } : {}
              }),
              item.identity.runtimeInstanceId,
              lease ? 'host-control' : 'host-data'
            ),
          attachRpc: (connection) => dispatch.attachAccountRuntimeConnection(connection)
        })
        presence.subscribeState((state) =>
          recordLifecycle({
            event: 'presence-state',
            runtimeId: item.identity.runtimeInstanceId,
            state
          })
        )
        services.push({
          item,
          presence,
          host,
          client: null,
          heartbeatSequences,
          get heartbeatResponses() {
            return heartbeatResponses
          },
          get refreshResponses() {
            return refreshResponses
          }
        })
        host.start()
        presence.setRuntimeReady(true)
      }
      const readyDeadline = Date.now() + 60_000
      while (
        services.some(
          (service) =>
            service.presence.getState() !== 'ONLINE' || service.host.getStatus() !== 'registered'
        )
      ) {
        expect(failures).toEqual([])
        expect(Date.now(), 'All Runtime services must become ready').toBeLessThan(readyDeadline)
        await sleep(250)
      }
      expect(failures).toEqual([])
      expect(
        new Set(services.map((service) => service.presence.getCurrentLeaseContext()!.tuple.bootId))
          .size
      ).toBe(runtimeCount)
      expect(
        new Set(
          services.map(
            (service) => service.presence.getCurrentLeaseContext()!.tuple.heartbeatLeaseId
          )
        ).size
      ).toBe(runtimeCount)
      const { connectServices, rpcRound } = createCapacityClientHarness({
        services,
        fixtureFetch,
        observedSocket,
        ca,
        recordLifecycle,
        recordLatency: (milliseconds) => latencies.push(milliseconds),
        closedSnapshot: (service) => ({
          latestHeartbeat: latestHeartbeat.get(service.item.identity.runtimeInstanceId)
        }),
        recordRequest: () => {
          requests += 1
        }
      })
      await connectServices()
      oldSessions = await rpcRound(-1)
      expect(new Set(oldSessions).size).toBe(runtimeCount)
      connectedStatus = await fixtureFetch<CloudStatus>('/fixture/status')
      const runtimeRecordIds = services.map((service) => service.item.tuple.runtimeRecordId)
      // Validate the RPC-to-database identity mapping before entering the long steady phase.
      assertRuntimeSessions(connectedStatus, runtimeRecordIds, oldSessions, 'ACTIVE')
      expect(connectedStatus.activeSessions).toBe(runtimeCount)
      expect(connectedStatus.currentAssignments).toBe(runtimeCount)
      expect(connectedStatus.cells.every((cell) => cell.activeSessions > 0)).toBe(true)
      await assertCapacityCellCounts(connectedStatus, cells)
      cellObservations.push({
        phase: 'connected',
        cells: cells.map((cell) => cell.readObservation())
      })
      const began = performance.now()
      phase = 'steady'
      for (let tick = 0; tick < durationSeconds; tick += 1) {
        expect(failures).toEqual([])
        await rpcRound(tick, true)
        if (tick % 30 === 0) {
          writeFileSync(
            join(evidence, 'progress.json'),
            JSON.stringify({ phase: 'steady', tick, requests, failures })
          )
        }
        await sleep(Math.max(0, began + (tick + 1) * 1000 - performance.now()))
      }
      steadyElapsedMs = performance.now() - began
      for (const service of services) {
        expect(service.heartbeatResponses).toBeGreaterThan(
          fenceTimeout ? 1 : simultaneousClose ? 1 : 5
        )
        if (!fenceTimeout) {
          expect(service.refreshResponses).toBeGreaterThan(1)
        }
        expect(
          service.heartbeatSequences.every(
            (sequence, index, all) =>
              Number.isSafeInteger(sequence) && sequence > (all[index - 1] ?? 0)
          )
        ).toBe(true)
      }
      const waitClosed = (ids: string[]) =>
        waitForClosed(() => fixtureFetch<CloudStatus>('/fixture/status'), ids)
      phase = 'await-old-sessions-closed'
      const closeInOrder = async (sessionIds: string[]) => {
        for (const [index, service] of services.entries()) {
          service.client!.close()
          // The real Host transition requests its own heartbeat after observing the close.
          await waitClosed([sessionIds[index]])
        }
      }
      const assertOldTerminal = (status: CloudStatus) =>
        assertOldTerminalSessions(
          status,
          runtimeRecordIds,
          oldSessions,
          recoveryStartedAt,
          terminalStatus
        )
      if (fenceTimeout) {
        phase = 'await-fence-delivery'
        const result = await runFenceTimeoutScenario({
          runtimeCount,
          durationSeconds,
          targetRuntimeId: fenceTargetRuntimeId!,
          services,
          cells,
          connectedStatus,
          oldSessions,
          ca,
          failures,
          lifecycle,
          fault: fenceFault!,
          fixtureFetch,
          rpcRound,
          connectServices,
          closeInOrder,
          recordLifecycle
        })
        terminalStatus = result.terminalStatus
        reconnectedStatus = result.reconnectedStatus
        finalStatus = result.finalStatus
        newSessions = result.newSessions
        fenceEvidence.push(result.evidence)
        passed = true
        phase = 'verified'
        return
      }
      if (simultaneousClose) {
        const before = await fixtureFetch<CloudStatus>('/fixture/status')
        leaseEvidence.push({
          phase: 'before-close',
          cloud: before.runtimes.map((runtime) => ({
            runtimeRecordId: runtime.runtimeRecordId,
            lease: runtime.lease
          })),
          local: services.map((service) => service.presence.getCurrentLeaseContext()?.tuple)
        })
        recoveryStartedAt = Date.now()
        phase = 'simultaneous-recovery'
        leaseEvidence.push(assertHeartbeatBurst(await fixtureFetch('/fixture/heartbeat-burst', {})))
        if (scenario === 'inflight-close') {
          services.forEach((service) => service.presence.requestHeartbeat())
          recordLifecycle({ event: 'close-during-heartbeat', scenario })
        }
        for (const service of services) {
          service.client!.close()
        }
        await vi.waitFor(
          async () => {
            expect(failures).toEqual([])
            const status = await fixtureFetch<CloudStatus>('/fixture/status')
            observeRevocationPending(status, oldSessions, recordLifecycle)
            assertOldTerminal(status)
            expect(status.activeSessions).toBe(0)
            expect(status.currentAssignments).toBe(runtimeCount)
            for (const service of services) {
              expect(service.presence.getState()).toBe('ONLINE')
              expect(service.host.getStatus()).toBe('registered')
            }
            terminalStatus = status
          },
          { timeout: 180_000, interval: 500 }
        )
        recoveryElapsedMs = Date.now() - recoveryStartedAt
        expect(recoveryResponses.some((event) => event.status === 503)).toBe(true)
        expect(terminalStatus!.heartbeat!.concurrencyLimit).toBe(16)
        expect(
          terminalStatus!.heartbeat!.concurrencyRejected - before.heartbeat!.concurrencyRejected
        ).toBe(recoveryResponses.filter((event) => event.status === 503).length)
        expect(terminalStatus!.workers!.errors).toEqual([])
        assertHeartbeatBurst(terminalStatus!.heartbeatBurst, true)
        expect(terminalStatus!.workers!.revocationRuns).toBeGreaterThan(0)
        expect(terminalStatus!.workers!.expiryRuns).toBeGreaterThan(0)
        if (scenario === 'inflight-close') {
          assertWorkerConvergence(before, terminalStatus!, oldSessions, lifecycle)
          leaseEvidence.push(
            assertInflightCoverage(
              lifecycle,
              services.map((service) => service.item.identity.runtimeInstanceId)
            )
          )
        }
        assertRecoveredLeases(
          before,
          terminalStatus!,
          recoveryResponses,
          services.map((service) => ({
            runtimeId: service.item.identity.runtimeInstanceId,
            runtimeRecordId: service.item.tuple.runtimeRecordId,
            leaseId: service.presence.getCurrentLeaseContext()!.tuple.heartbeatLeaseId
          }))
        )
        leaseEvidence.push({
          phase: 'recovered',
          cloud: terminalStatus!.runtimes.map((runtime) => ({
            runtimeRecordId: runtime.runtimeRecordId,
            lease: runtime.lease
          })),
          local: services.map((service) => service.presence.getCurrentLeaseContext()?.tuple)
        })
      } else {
        await closeInOrder(oldSessions)
      }
      phase = 'reconnect'
      await connectServices()
      newSessions = await rpcRound(durationSeconds + 1)
      expect(new Set([...oldSessions, ...newSessions]).size).toBe(runtimeCount * 2)
      reconnectedStatus = await fixtureFetch<CloudStatus>('/fixture/status')
      if (simultaneousClose) {
        assertOldTerminal(reconnectedStatus)
      } else {
        assertRuntimeSessions(reconnectedStatus, runtimeRecordIds, oldSessions, 'CLOSED')
      }
      assertRuntimeSessions(reconnectedStatus, runtimeRecordIds, newSessions, 'ACTIVE')
      expect(reconnectedStatus.activeSessions).toBe(runtimeCount)
      await assertCapacityCellCounts(reconnectedStatus, cells)
      cellObservations.push({
        phase: 'reconnected',
        cells: cells.map((cell) => cell.readObservation())
      })
      if (simultaneousClose) {
        phase = 'recovered-steady'
        const recoveredBegan = performance.now()
        for (let tick = 0; tick < 60; tick += 1) {
          expect(failures).toEqual([])
          expect(await rpcRound(durationSeconds + 2 + tick, true)).toEqual(newSessions)
          const status = await fixtureFetch<CloudStatus>('/fixture/status')
          assertOldTerminal(status)
          assertRuntimeSessions(status, runtimeRecordIds, newSessions, 'ACTIVE')
          expect(status.workers!.errors).toEqual([])
          await sleep(Math.max(0, recoveredBegan + (tick + 1) * 1000 - performance.now()))
        }
        recoveredSteadyElapsedMs = performance.now() - recoveredBegan
      }
      phase = 'await-new-sessions-closed'
      await closeInOrder(newSessions)
      finalStatus = await fixtureFetch<CloudStatus>('/fixture/status')
      if (simultaneousClose) {
        assertOldTerminal(finalStatus)
        expect(finalStatus.workers!.errors).toEqual([])
      }
      expect(finalStatus.activeSessions).toBe(0)
      await Promise.all(services.map((service) => service.presence.stop()))
      await Promise.all(services.map((service) => service.host.stop()))
      await vi.waitFor(
        () => {
          for (const cell of cells) {
            const metrics = cell.readObservation().metrics
            for (const key of [
              'preauth',
              'authenticated',
              'owners',
              'connections',
              'ingress_bytes'
            ]) {
              expect(metrics[key]).toBe(0)
            }
          }
        },
        { timeout: 15_000, interval: 250 }
      )
      expect(failures).toEqual([])
      cellObservations.push({ phase: 'closed', cells: cells.map((cell) => cell.readObservation()) })
      passed = true
      phase = 'verified'
    } catch (error) {
      mainFailure = capacityFailure(error)
      throw error
    } finally {
      if (observationTimer) {
        clearInterval(observationTimer)
      }
      await observationTail
      for (const service of services) {
        service.client?.close()
      }
      for (const operations of [
        () => services.map((service) => service.presence.stop()),
        () => services.map((service) => service.host.stop()),
        () => cells.map((cell) => cell.stop())
      ]) {
        for (const result of await Promise.allSettled(operations())) {
          if (result.status === 'rejected') {
            failures.push(`Cleanup: ${String(result.reason)}`)
          }
        }
      }
      latencies.sort((a, b) => a - b)
      writeFileSync(
        join(evidence, 'account-capacity-lifecycle.json'),
        JSON.stringify(lifecycle, null, 2)
      )
      writeFileSync(
        join(evidence, 'account-capacity-summary.json'),
        JSON.stringify(
          {
            passed: passed && failures.length === 0,
            phase,
            mainFailure,
            scenario,
            scope:
              '30 isolated PresenceService/HostService/storage identities in one Node process; real encrypted account channels and account RPC dispatch; fixture echo handler, not 30 full desktop/Runtime OS processes',
            runtimeCount,
            clientCount: services.filter((service) => service.client).length,
            disconnectMode: simultaneousClose
              ? `${scenario}: 30 closes under a 500ms database lock; bounded recovery and ordered final cleanup`
              : 'one client at a time, await its Cloud CLOSED transition; simultaneous-close overload recovery is not covered',
            startedAt,
            durationSeconds,
            steadyElapsedMs,
            recoveryElapsedMs,
            recoveredSteadyElapsedMs,
            recoveryResponses,
            leaseEvidence,
            suppressedControlCommands: fenceFault?.suppressedCommands ?? [],
            fenceEvidence,
            terminalStatus,
            requests,
            measuredRequests: latencies.length,
            rpcP95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? null,
            failures,
            heartbeatResponses: services.map((service) => service.heartbeatResponses),
            refreshResponses: services.map((service) => service.refreshResponses),
            heartbeatSequences: services.map((service) => service.heartbeatSequences),
            cellObservations,
            observationReadGaps: cells.map((cell) => cell.observationReadGaps()),
            cellDiagnostics: passed
              ? []
              : cells.map((cell) => capacityDiagnostic(cell.diagnostic())),
            connectedStatus,
            reconnectedStatus,
            finalStatus
          },
          null,
          2
        )
      )
      expect(dirname(resolve(storage))).toBe(storageRoot)
      expect(basename(storage)).toMatch(/^account-path-/)
      rmSync(storage, { recursive: true, force: true })
      if (!mainFailure) {
        expect(failures).toEqual([])
      }
    }
  },
  1_000_000
)
