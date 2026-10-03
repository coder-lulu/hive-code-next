import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { createHiveRuntimeRelayAccountConsumeInput } from './hive-runtime-relay-account-binding'
import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'

it('matches the Cloud length-prefixed big-endian session binding transcript', () => {
  const key = Buffer.alloc(32)
  const input = createHiveRuntimeRelayAccountConsumeInput(
    {
      cellId: 'cell-a',
      cellIncarnationId: '19191919-1919-4919-8919-191919191919',
      assignmentId: '18181818-1818-4818-8818-181818181818',
      assignmentEpoch: 4,
      controlGeneration: 5,
      hostPublicKeyB64: key.toString('base64url')
    } as HiveRuntimeRelayAssignment,
    {
      type: 'conn-open',
      v: 2,
      kind: 'ticket',
      connId: 'conn-a',
      connTicket: key.toString('base64url'),
      intentId: '17171717-1717-4717-8717-171717171717',
      assignmentEpoch: 4,
      controlGeneration: 5,
      clientKeyHash: createHash('sha256').update(key).digest('base64url'),
      attachDeadlineMs: 5000
    },
    {
      type: 'e2ee_auth',
      principalKind: 'account_runtime_session',
      ticketId: '15151515-1515-4515-8515-151515151515',
      ticketSecret: key.toString('base64url')
    },
    { clientPublicKeyB64: key.toString('base64'), transcriptHashB64: key.toString('base64') },
    '16161616-1616-4616-8616-161616161616'
  )
  // Vector independently calculated from the Java adapter's DataOutputStream transcript.
  expect(input.sessionBindingHash).toBe('FQsjJiSbWiP21V0Hg90ZEHON9aLzShaEGCrPWEMuj6A')
})
