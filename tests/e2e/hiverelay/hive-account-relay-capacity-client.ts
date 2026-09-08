import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { expect } from 'vitest'
import type { HiveRuntimeCloudPresenceService } from '../../../src/main/hive-runtime-cloud/hive-runtime-cloud-presence-service'
import type { HiveRuntimeRelayHostService } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-host-service'
import {
  HiveAccountRelayChannel,
  type HiveAccountRelaySocket
} from '../../../src/shared/hive-account-relay-channel'
import { acquireHiveAccountRelayMaterial } from '../../../src/shared/hive-account-relay-material'
import type { CloudStatus, RuntimeFixture } from './hive-account-relay-capacity-types'

export type CapacityClientService = {
  item: RuntimeFixture
  presence: HiveRuntimeCloudPresenceService
  host: HiveRuntimeRelayHostService
  client: HiveAccountRelayChannel | null
}

export function createCapacityClientHarness(options: {
  services: CapacityClientService[]
  fixtureFetch: <T>(path: string, body?: object) => Promise<T>
  observedSocket: (socket: WebSocket, runtimeId: string, role: string) => WebSocket
  ca: Buffer[]
  recordLifecycle: (event: Record<string, unknown>) => void
  recordLatency: (milliseconds: number) => void
  recordRequest: () => void
  closedSnapshot: (service: CapacityClientService) => Record<string, unknown>
}) {
  const connectServices = async (selected: CapacityClientService[] = options.services) => {
    const status = await options.fixtureFetch<CloudStatus>('/fixture/status')
    for (const service of selected) {
      const material = await acquireHiveAccountRelayMaterial({
        clientKind: 'DESKTOP',
        expectedResourceVersion: status.runtimes.find(
          (item) => item.runtimeRecordId === service.item.tuple.runtimeRecordId
        )!.resourceVersion,
        createIntent: (request) =>
          options.fixtureFetch('/fixture/intent', {
            runtimeRecordId: service.item.tuple.runtimeRecordId,
            secretHash: request.ticketSecretSha256,
            clientPublicKey: request.clientPublicKeyB64
          })
      })
      service.client = new HiveAccountRelayChannel({
        material,
        createSocket: (url) =>
          options.observedSocket(
            new WebSocket(url, { ca: options.ca, perMessageDeflate: false }),
            service.item.identity.runtimeInstanceId,
            'account-client'
          ) as unknown as HiveAccountRelaySocket,
        onClosed: (_error, intentional) =>
          options.recordLifecycle({
            event: 'account-channel-closed',
            runtimeId: service.item.identity.runtimeInstanceId,
            intentional,
            host: service.host.getStatus(),
            presence: service.presence.getState(),
            ...options.closedSnapshot(service)
          })
      })
      await service.client.connect()
    }
  }

  const rpcRound = async (
    tick: number,
    measure = false,
    selected: CapacityClientService[] = options.services
  ) =>
    Promise.all(
      selected.map(async (service) => {
        const nonce = randomUUID()
        const before = performance.now()
        const response = await service.client!.request({
          id: `${service.item.identity.runtimeInstanceId}:${tick}:${nonce}`,
          method: 'capacity.echo',
          params: { runtimeRecordId: service.item.tuple.runtimeRecordId, nonce, tick }
        })
        if (measure) {
          options.recordLatency(performance.now() - before)
        }
        expect(response).toMatchObject({
          ok: true,
          result: {
            runtimeRecordId: service.item.tuple.runtimeRecordId,
            runtimeInstanceId: service.item.identity.runtimeInstanceId,
            nonce,
            tick,
            principal: expect.stringMatching(/^account-runtime:/),
            runtimeSessionId: expect.any(String)
          }
        })
        options.recordRequest()
        return (response as { result: { runtimeSessionId: string } }).result.runtimeSessionId
      })
    )

  return { connectServices, rpcRound }
}
