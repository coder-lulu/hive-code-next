import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import { issueHostChallenge } from './hiverelay-host-proof'
import {
  HostChallengeAckSchema,
  HostHelloSchema,
  deriveHiveRelayHostId,
  fromBase64Url,
  parseStrictJson,
  type HostHello
} from './hiverelay-test-wire'
import {
  MOCK_CELL_POLICY_CLOSE,
  MOCK_CELL_DRAINING_CLOSE,
  MOCK_CELL_STALE_BINDING_CLOSE,
  closeMockCellSocket,
  readMockCellBearer,
  sameMockCellBinding,
  sendMockCellJson,
  type ProgrammableMockCellOptions
} from './hiverelay-mock-cell-state'
import { wireText } from './hiverelay-websocket-peer'

export function acceptMockCellControl(args: {
  socket: WebSocket
  request: IncomingMessage
  options: ProgrammableMockCellOptions
  currentIncarnationId: string
  draining: boolean
  onActive: (socket: WebSocket, hello: HostHello) => void
  onClosed: (socket: WebSocket) => void
}): void {
  const { socket } = args
  if (args.draining) {
    closeMockCellSocket(socket, MOCK_CELL_DRAINING_CLOSE, 'DRAINING')
    return
  }
  if (readMockCellBearer(args.request) !== args.options.controlLease) {
    closeMockCellSocket(socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_CONTROL_LEASE')
    return
  }
  socket.once('message', (raw, isBinary) => {
    if (isBinary) {
      closeMockCellSocket(socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_HOST_HELLO')
      return
    }
    let hello: HostHello
    try {
      hello = parseStrictJson(wireText(raw), HostHelloSchema)
    } catch {
      closeMockCellSocket(socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_HOST_HELLO')
      return
    }
    const key = fromBase64Url(hello.hostPublicKeyB64, 32)
    const expected = { ...args.options.binding, cellIncarnationId: args.currentIncarnationId }
    if (
      !key ||
      deriveHiveRelayHostId(key) !== hello.relayHostId ||
      !sameMockCellBinding(hello, expected)
    ) {
      closeMockCellSocket(socket, MOCK_CELL_STALE_BINDING_CLOSE, 'STALE_BINDING')
      return
    }
    proveHost({ ...args, hello })
  })
  socket.once('close', () => args.onClosed(socket))
}

function proveHost(args: Parameters<typeof acceptMockCellControl>[0] & { hello: HostHello }): void {
  const challenge = issueHostChallenge({
    hello: args.hello,
    cellOrigin: args.options.cellOrigin,
    now: (args.options.now ?? Date.now)(),
    random: args.options.random
  })
  sendMockCellJson(args.socket, challenge.message)
  args.socket.once('message', (raw, isBinary) => {
    if (isBinary) {
      closeMockCellSocket(args.socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_HOST_PROOF')
      return
    }
    try {
      const ack = parseStrictJson(wireText(raw), HostChallengeAckSchema)
      if (
        ack.challengeId !== challenge.message.challengeId ||
        ack.proofB64 !== challenge.expectedProofB64
      ) {
        throw new Error('Host proof mismatch')
      }
    } catch {
      closeMockCellSocket(args.socket, MOCK_CELL_POLICY_CLOSE, 'INVALID_HOST_PROOF')
      return
    }
    args.onActive(args.socket, args.hello)
    sendMockCellJson(args.socket, {
      type: 'host-hello-ack',
      v: 2,
      controlGeneration: args.hello.controlGeneration,
      leaseExpiresAt: (args.options.now ?? Date.now)() + 120_000
    })
  })
}
