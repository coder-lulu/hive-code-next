import { grantCommand } from '../../shared/hive-ai-text-grant.test-fixture'
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, verify, createHash } from 'node:crypto'
import { createHiveAiTextProof, HIVE_AI_TEXT_PROOF_DOMAIN } from './hive-ai-runtime-proof'
import { controlCommand, controlOwner } from '../../shared/hive-ai-text-control.test-fixture'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
const pair = generateKeyPairSync('ed25519')
const controlIdentity: HiveRuntimeCloudIdentity = {
  schemaVersion: 1,
  runtimeInstanceId: controlCommand.runtime.runtimeInstanceId,
  privateKeyPkcs8: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  publicKey: pair.publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('base64url'),
  createdAt: Date.now()
}
const input = {
  command: controlCommand,
  owner: controlOwner,
  identity: controlIdentity,
  authorityId: 'authority',
  operation: 'status' as const,
  issuedAt: '2026-09-15T00:00:00Z',
  nonce: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
}
describe('main-process real text proof', () => {
  it.each(['status', 'cancel'] as const)(
    'signs exact metadata bytes and fixed %s scope',
    (operation) => {
      const signed = createHiveAiTextProof({ ...input, operation })
      const proof = JSON.parse(Buffer.from(signed.header, 'base64url').toString('utf8'))
      expect(proof.domain).toBe(HIVE_AI_TEXT_PROOF_DOMAIN)
      expect(proof.path).toBe(`/hive/v1/ai/inferences/${operation}`)
      expect(proof.bodySha256).toBe(createHash('sha256').update(signed.body).digest('hex'))
      expect(proof.bodySha256).toBe(
        'aea259b668d1bb868b13bdbe751801059d7b42719d30458185c3f35b91fb73f0'
      )
      const fields = {
        ...proof,
        accountId: proof.owner.accountId,
        deviceId: proof.owner.deviceId,
        runtimeRecordId: proof.owner.runtimeRecordId
      }
      delete fields.owner
      delete fields.signature
      const canonical = JSON.stringify(
        Object.fromEntries(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      )
      if (operation === 'status') {
        expect(createHash('sha256').update(canonical).digest('hex')).toBe(
          '91eeab137a3f24c0befc08754f0def1524bd29d3eeab7c434adfe42c9b82419a'
        )
      }
      expect(
        verify(
          null,
          Buffer.from(canonical),
          pair.publicKey,
          Buffer.from(proof.signature, 'base64url')
        )
      ).toBe(true)
      expect(
        verify(
          null,
          Buffer.from(canonical.replace(HIVE_AI_TEXT_PROOF_DOMAIN, 'hive-ai-synthetic-pop/v1')),
          pair.publicKey,
          Buffer.from(proof.signature, 'base64url')
        )
      ).toBe(false)
      expect(JSON.parse(signed.body)).toEqual(controlCommand)
      expect(signed.body).not.toContain('privateKey')
    }
  )
  it('rejects cross-Runtime identities and authority overrides without reflecting private data', () => {
    for (const bad of [
      { ...input, authorityId: 'https://untrusted.test' },
      { ...input, owner: { ...controlOwner, runtimeRecordId: controlOwner.accountId } },
      { ...input, identity: { ...controlIdentity, runtimeInstanceId: controlOwner.accountId } },
      { ...input, nonce: 'bad' },
      { ...input, command: { ...controlCommand, url: 'SECRET_CANARY' } },
      { ...input, identity: { ...controlIdentity, privateKeyPkcs8: 'SECRET_CANARY' } }
    ]) {
      expect(() => createHiveAiTextProof(bad)).toThrow(/^hive_ai_invalid_runtime_proof$/)
    }
  })
})

it.each(['grant', 'inference'] as const)(
  'binds the %s endpoint and full Pack/content body to the real Runtime signature',
  (operation) => {
    const path = operation === 'grant' ? '/hive/v1/ai/grants' : '/hive/v1/ai/inferences'
    const otherPath = operation === 'grant' ? '/hive/v1/ai/inferences' : '/hive/v1/ai/grants'
    const signed = createHiveAiTextProof({ ...input, command: grantCommand, operation })
    const proof = JSON.parse(Buffer.from(signed.header, 'base64url').toString('utf8'))
    expect(proof.path).toBe(path)
    expect(proof.bodySha256).toBe(createHash('sha256').update(signed.body).digest('hex'))
    expect(JSON.parse(signed.body)).toEqual(grantCommand)
    const fields = {
      ...proof,
      accountId: proof.owner.accountId,
      deviceId: proof.owner.deviceId,
      runtimeRecordId: proof.owner.runtimeRecordId
    }
    delete fields.owner
    delete fields.signature
    const canonical = JSON.stringify(
      Object.fromEntries(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    )
    expect(
      verify(
        null,
        Buffer.from(canonical),
        pair.publicKey,
        Buffer.from(proof.signature, 'base64url')
      )
    ).toBe(true)
    expect(
      verify(
        null,
        Buffer.from(canonical.replace(path, otherPath)),
        pair.publicKey,
        Buffer.from(proof.signature, 'base64url')
      )
    ).toBe(false)
    expect(() =>
      createHiveAiTextProof({
        ...input,
        command: { ...grantCommand, owner: controlOwner },
        operation
      })
    ).toThrow('hive_ai_invalid_runtime_proof')
  }
)
