import { createHash } from 'node:crypto'
import type {
  E2EEAccountAuth,
  E2EEAccountBinding
} from '../../runtime/rpc/e2ee-channel-account-authentication'
import type {
  HiveRuntimeRelayAssignment,
  HiveRuntimeRelayConsumeInput
} from './hive-runtime-relay-types'
import type { ConnectionOpen } from './hive-runtime-relay-protocol'

function decode(value: string, encoding: 'base64' | 'base64url'): Buffer {
  const bytes = Buffer.from(value, encoding)
  if (bytes.length !== 32 || bytes.toString(encoding) !== value) {
    throw new Error('hive_account_binding_rejected')
  }
  return bytes
}
function integer(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('hive_account_binding_rejected')
  }
  const result = Buffer.alloc(8)
  result.writeBigUInt64BE(BigInt(value))
  return result
}
export function createHiveRuntimeRelayAccountConsumeInput(
  assignment: HiveRuntimeRelayAssignment,
  connection: ConnectionOpen,
  auth: E2EEAccountAuth,
  binding: E2EEAccountBinding,
  consumeAttemptId: string
): HiveRuntimeRelayConsumeInput {
  const clientKey = decode(binding.clientPublicKeyB64, 'base64')
  const transcript = decode(binding.transcriptHashB64, 'base64')
  const clientKeyHash = createHash('sha256').update(clientKey).digest('base64url')
  if (
    clientKeyHash !== connection.clientKeyHash ||
    connection.assignmentEpoch !== assignment.assignmentEpoch ||
    connection.controlGeneration !== assignment.controlGeneration
  ) {
    throw new Error('hive_account_binding_rejected')
  }
  const fields: [string, Buffer][] = [
    ['domain', Buffer.from('hive-relay-session-binding/v2')],
    ['intentId', Buffer.from(connection.intentId)],
    ['ticketId', Buffer.from(auth.ticketId)],
    ['cellId', Buffer.from(assignment.cellId)],
    ['cellIncarnationId', Buffer.from(assignment.cellIncarnationId)],
    ['connId', Buffer.from(connection.connId)],
    ['assignmentId', Buffer.from(assignment.assignmentId)],
    ['assignmentEpoch', integer(assignment.assignmentEpoch)],
    ['controlGeneration', integer(assignment.controlGeneration)],
    ['clientPublicKey', clientKey],
    ['runtimePublicKey', decode(assignment.hostPublicKeyB64, 'base64url')],
    ['e2eeTranscriptHash', transcript]
  ]
  const digest = createHash('sha256')
  for (const [name, value] of fields) {
    const nameBytes = Buffer.from(name)
    const nameSize = Buffer.alloc(4)
    nameSize.writeUInt32BE(nameBytes.length)
    const valueSize = Buffer.alloc(4)
    valueSize.writeUInt32BE(value.length)
    digest.update(nameSize).update(nameBytes).update(valueSize).update(value)
  }
  return {
    consumeAttemptId,
    ticketSecret: auth.ticketSecret,
    intentId: connection.intentId,
    assignmentId: assignment.assignmentId,
    assignmentEpoch: assignment.assignmentEpoch,
    controlGeneration: assignment.controlGeneration,
    cellId: assignment.cellId,
    cellIncarnationId: assignment.cellIncarnationId,
    connId: connection.connId,
    clientKeyHash,
    e2eeTranscriptHash: transcript.toString('base64url'),
    sessionBindingHash: digest.digest('base64url')
  }
}
