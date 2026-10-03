import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { HiveRuntimeRelayCloudClient } from './hive-runtime-relay-cloud-client'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'

it.each([
  `account-runtime:${'a'.repeat(64)}`,
  undefined,
  'trusted-local:runtime',
  'account-runtime:short'
])('validates the Cloud-issued operation identity (%s)', async (operationCallerKey) => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const context: CurrentHiveRuntimeCloudLeaseContext = {
    authorityId: 'cloud',
    identity: {
      schemaVersion: 1,
      runtimeInstanceId: randomUUID(),
      createdAt: Date.now(),
      privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    },
    tuple: {
      runtimeRecordId: randomUUID(),
      runtimeInstanceId: randomUUID(),
      bootId: randomUUID(),
      heartbeatLeaseId: randomUUID(),
      authorityGeneration: 1,
      leaseEpoch: 1,
      fencingEpoch: 1
    }
  }
  const body = {
    protocolVersion: 'account-runtime-ticket-consume/v2',
    managedSessionId: randomUUID(),
    runtimeSessionId: randomUUID(),
    operationCallerKey,
    status: 'PENDING_ACTIVATION',
    activationDeadlineAt: Date.now() + 1000,
    absoluteExpiresAt: Date.now() + 10000,
    controlVersion: 1
  }
  const client = new HiveRuntimeRelayCloudClient(
    'https://fixture.invalid',
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
  )
  const result = client.consume(context, randomUUID(), {
    consumeAttemptId: randomUUID(),
    ticketSecret: 'A'.repeat(43),
    intentId: randomUUID(),
    assignmentId: randomUUID(),
    assignmentEpoch: 1,
    controlGeneration: 1,
    cellId: 'cell',
    cellIncarnationId: randomUUID(),
    connId: 'connection',
    clientKeyHash: 'A'.repeat(43),
    e2eeTranscriptHash: 'A'.repeat(43),
    sessionBindingHash: 'A'.repeat(43)
  })
  await (operationCallerKey === `account-runtime:${'a'.repeat(64)}`
    ? expect(result).resolves.toMatchObject({ operationCallerKey })
    : expect(result).rejects.toThrow())
})
