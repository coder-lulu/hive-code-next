import { randomUUID } from 'node:crypto'
import {
  canonicalRuntimeHeartbeatBody,
  sha256,
  signRuntimeIdentityPayload
} from './hive-runtime-cloud-proof-core'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import { parseHiveAiTextGrantRequest } from '../../shared/hive-ai-text-grant-request'
import {
  hiveAiRuntimeOwnerSchema,
  parseHiveAiTextControlRequest,
  type HiveAiRuntimeOwner
} from '../../shared/hive-ai-text-control'

export const HIVE_AI_TEXT_PROOF_DOMAIN = 'hive-ai-text-pop/v1'
export const HIVE_AI_TEXT_CONTROL_PATHS = {
  status: '/hive/v1/ai/inferences/status',
  cancel: '/hive/v1/ai/inferences/cancel'
} as const
export type HiveAiTextControlOperation = keyof typeof HIVE_AI_TEXT_CONTROL_PATHS
export const HIVE_AI_TEXT_GRANT_PATH = '/hive/v1/ai/grants'
export const HIVE_AI_TEXT_INFERENCE_PATH = '/hive/v1/ai/inferences'

/** Main-process identity proof only. It grants neither spending nor another dispatch claim. */
export function createHiveAiTextProof(input: {
  command: unknown
  owner: HiveAiRuntimeOwner
  identity: HiveRuntimeCloudIdentity
  authorityId: string
  operation: HiveAiTextControlOperation | 'grant' | 'inference'
  issuedAt?: string
  nonce?: string
}) {
  try {
    const command =
      input.operation === 'grant' || input.operation === 'inference'
        ? parseHiveAiTextGrantRequest(input.command)
        : parseHiveAiTextControlRequest(input.command)
    const owner = hiveAiRuntimeOwnerSchema.parse(input.owner)
    const path =
      input.operation === 'inference'
        ? HIVE_AI_TEXT_INFERENCE_PATH
        : input.operation === 'grant'
          ? HIVE_AI_TEXT_GRANT_PATH
          : HIVE_AI_TEXT_CONTROL_PATHS[input.operation]
    if (
      typeof path !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.authorityId) ||
      owner.runtimeRecordId !== command.runtime.runtimeRecordId ||
      input.identity.runtimeInstanceId !== command.runtime.runtimeInstanceId
    ) {
      throw new Error('hive_ai_invalid_runtime_proof')
    }
    const body = canonicalRuntimeHeartbeatBody(command)
    const proof = {
      domain: HIVE_AI_TEXT_PROOF_DOMAIN,
      algorithm: 'Ed25519',
      authorityId: input.authorityId,
      method: 'POST',
      path,
      owner,
      nonce: input.nonce ?? randomUUID(),
      issuedAt: input.issuedAt ?? new Date().toISOString(),
      bodySha256: sha256(body)
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(proof.nonce) ||
      !Number.isFinite(Date.parse(proof.issuedAt))
    ) {
      throw new Error('hive_ai_invalid_runtime_proof')
    }
    const canonical = canonicalRuntimeHeartbeatBody({
      domain: proof.domain,
      algorithm: proof.algorithm,
      authorityId: proof.authorityId,
      method: proof.method,
      path: proof.path,
      accountId: owner.accountId,
      deviceId: owner.deviceId,
      runtimeRecordId: owner.runtimeRecordId,
      nonce: proof.nonce,
      issuedAt: proof.issuedAt,
      bodySha256: proof.bodySha256
    })
    const header = Buffer.from(
      JSON.stringify({
        ...proof,
        signature: signRuntimeIdentityPayload(canonical, input.identity)
      }),
      'utf8'
    ).toString('base64url')
    return { body, header }
  } catch {
    throw new Error('hive_ai_invalid_runtime_proof')
  }
}
