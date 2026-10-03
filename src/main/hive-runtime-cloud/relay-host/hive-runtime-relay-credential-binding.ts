import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'
import { exactKeys, isRecord } from '../hive-runtime-cloud-response'
import type { HiveRuntimeRelayCloudClient } from './hive-runtime-relay-cloud-client'
import { parseStrictJson } from './hive-runtime-relay-protocol'

function reject(): never {
  throw new Error('hive_runtime_relay_credential_binding_rejected')
}
function decode(value: string): Record<string, unknown> {
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.toString('base64url') !== value) {
    return reject()
  }
  let parsed: unknown
  try {
    parsed = parseStrictJson(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      z.record(z.string(), z.unknown())
    )
  } catch {
    return reject()
  }
  if (!isRecord(parsed)) {
    return reject()
  }
  return parsed
}
function uint64(value: number): Buffer {
  const result = Buffer.alloc(8)
  result.writeBigUInt64BE(BigInt(value))
  return result
}
export function hiveRuntimeRelayTupleHash(context: CurrentHiveRuntimeCloudLeaseContext): string {
  const tuple = context.tuple
  const fields: [string, Buffer][] = [
    ['domain', Buffer.from('hive-relay-runtime-tuple/v2')],
    ['runtimeId', Buffer.from(tuple.runtimeInstanceId)],
    ['runtimeBootId', Buffer.from(tuple.bootId)],
    ['authorityGeneration', uint64(tuple.authorityGeneration)],
    ['fencingEpoch', uint64(tuple.fencingEpoch)],
    ['leaseEpoch', uint64(tuple.leaseEpoch)]
  ]
  const digest = createHash('sha256')
  for (const [name, value] of fields) {
    const nameBytes = Buffer.from(name)
    const nameLength = Buffer.alloc(4)
    nameLength.writeUInt32BE(nameBytes.length)
    const valueLength = Buffer.alloc(4)
    valueLength.writeUInt32BE(value.length)
    digest.update(nameLength).update(nameBytes).update(valueLength).update(value)
  }
  return digest.digest('base64url')
}

// HTTPS authenticates this projection; the Cell independently verifies the signed credential.
export function requireHiveRuntimeRelayControlBinding(
  assignment: Awaited<ReturnType<HiveRuntimeRelayCloudClient['assign']>>,
  context: CurrentHiveRuntimeCloudLeaseContext,
  hostKeyHash: string,
  now: number
): number {
  const [headerPart, claimsPart, signature] = assignment.controlLease.split('.')
  const header = decode(headerPart)
  exactKeys(header, ['alg', 'typ', 'kid'])
  if (
    header.alg !== 'EdDSA' ||
    header.typ !== 'relay-control+jwt' ||
    typeof header.kid !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(header.kid) ||
    Buffer.from(signature, 'base64url').length !== 64 ||
    Buffer.from(signature, 'base64url').toString('base64url') !== signature
  ) {
    return reject()
  }
  const claims = decode(claimsPart)
  exactKeys(claims, [
    'iss',
    'sub',
    'aud',
    'scope',
    'jti',
    'iat',
    'nbf',
    'exp',
    'cellId',
    'cellIncarnationId',
    'assignmentId',
    'relayHostId',
    'hostKeyHash',
    'runtimeTupleHash',
    'authorityGeneration',
    'fencingEpoch',
    'leaseEpoch',
    'assignmentEpoch',
    'controlGeneration'
  ])
  const tuple = context.tuple
  const matching = {
    sub: tuple.runtimeInstanceId,
    aud: 'hive-relay-cell',
    scope: 'relay:control',
    cellId: assignment.cellId,
    cellIncarnationId: assignment.cellIncarnationId,
    assignmentId: assignment.assignmentId,
    relayHostId: assignment.relayHostId,
    hostKeyHash,
    runtimeTupleHash: hiveRuntimeRelayTupleHash(context),
    authorityGeneration: tuple.authorityGeneration,
    fencingEpoch: tuple.fencingEpoch,
    leaseEpoch: tuple.leaseEpoch,
    assignmentEpoch: assignment.assignmentEpoch
  }
  if (Object.entries(matching).some(([key, value]) => claims[key] !== value)) {
    return reject()
  }
  if (
    typeof claims.iss !== 'string' ||
    !/^https:\/\/[^/?#@]+(?:\/[^?#]*)?$/.test(claims.iss) ||
    typeof claims.jti !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(claims.jti)
  ) {
    return reject()
  }
  for (const name of ['iat', 'nbf', 'exp', 'controlGeneration']) {
    if (
      typeof claims[name] !== 'number' ||
      !Number.isSafeInteger(claims[name]) ||
      claims[name] < 0
    ) {
      return reject()
    }
  }
  const { iat, nbf, exp } = claims as { iat: number; nbf: number; exp: number }
  if (
    exp <= iat ||
    exp - iat > 120 ||
    nbf !== iat ||
    iat * 1000 > now + 30_000 ||
    exp * 1000 <= now ||
    exp * 1000 !== assignment.controlLeaseExpiresAt
  ) {
    return reject()
  }
  return claims.controlGeneration as number
}
