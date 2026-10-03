import WebSocket from 'ws'
import registry from '../../../../config/hiverelay-contract/registries/close-codes.json'
import type { ControlLeaseForCell, HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'
import type { HiveRelayBinding } from './hive-runtime-relay-protocol'

export const HIVE_RELAY_CLOSE = Object.freeze(
  Object.fromEntries(registry.codes.map(({ symbol, code }) => [symbol, code]))
)

export type HiveRuntimeRelaySocketFactory = (
  url: string,
  controlLease?: ControlLeaseForCell
) => WebSocket

export const createHiveRuntimeRelaySocket: HiveRuntimeRelaySocketFactory = (url, controlLease) =>
  new WebSocket(url, {
    ...(controlLease ? { headers: { authorization: `Bearer ${controlLease}` } } : {}),
    perMessageDeflate: false,
    followRedirects: false,
    maxPayload: controlLease ? 16_384 : 8_388_690,
    handshakeTimeout: 5_000
  })

export function hiveRuntimeRelaySocketUrl(origin: string, path: string): string {
  const url = new URL(origin)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('hive_runtime_relay_invalid_origin')
  }
  url.protocol = 'wss:'
  url.pathname = path
  return url.href
}

export function closeHiveRuntimeRelaySocket(socket: WebSocket, code: number): void {
  // Peer abnormal-close sentinels (1005/1006/1015) cannot appear on the wire.
  try {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(Object.values(HIVE_RELAY_CLOSE).includes(code) ? code : 1000)
    }
  } finally {
    socket.terminate()
  }
}

export function hiveRuntimeRelayWireBinding(value: HiveRuntimeRelayAssignment): HiveRelayBinding {
  const tuple = value.context.tuple
  return {
    cellId: value.cellId,
    cellIncarnationId: value.cellIncarnationId,
    runtimeId: tuple.runtimeInstanceId,
    runtimeBootId: tuple.bootId,
    authorityGeneration: tuple.authorityGeneration,
    fencingEpoch: tuple.fencingEpoch,
    leaseEpoch: tuple.leaseEpoch,
    assignmentId: value.assignmentId,
    assignmentEpoch: value.assignmentEpoch,
    controlGeneration: value.controlGeneration,
    relayHostId: value.relayHostId
  }
}

export function hiveRuntimeRelaySameOwner(
  a: HiveRuntimeRelayAssignment,
  b: HiveRuntimeRelayAssignment
): boolean {
  return (
    a.cellOrigin === b.cellOrigin &&
    JSON.stringify(hiveRuntimeRelayWireBinding(a)) ===
      JSON.stringify(hiveRuntimeRelayWireBinding(b))
  )
}
