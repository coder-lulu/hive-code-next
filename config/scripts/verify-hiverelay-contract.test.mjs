import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseStrictJsonDocument,
  sha256Bytes,
  verifyHiveRelayContract
} from './verify-hiverelay-contract.mjs'

const sandboxes = []

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function createContractSandbox() {
  const root = await mkdtemp(path.join(tmpdir(), 'hiverelay-contract-'))
  sandboxes.push(root)
  const contractRoot = path.join(root, 'config', 'hiverelay-contract')
  const receiptPath = path.join(root, 'config', 'hiverelay-contract-source.json')
  await mkdir(path.join(contractRoot, 'fixtures', 'v2'), { recursive: true })
  await mkdir(path.join(contractRoot, 'schemas'), { recursive: true })
  const fixturePath = 'fixtures/v2/accepted.json'
  const fixtureBytes = Buffer.from('{"type":"relay-auth","v":2}\n')
  const schemaBytes = Buffer.from('{"$schema":"https://json-schema.org/draft/2020-12/schema"}\n')
  await writeFile(path.join(contractRoot, fixturePath), fixtureBytes)
  await writeFile(path.join(contractRoot, 'schemas', 'relay-auth.schema.json'), schemaBytes)
  const manifest = {
    schemaVersion: 1,
    contractRevision: 'hiverelay-v2-p0-r1',
    files: [
      {
        path: 'schemas/relay-auth.schema.json',
        kind: 'schema',
        applicableComponents: ['cloud', 'hivecode', 'cell'],
        sha256: sha256Bytes(schemaBytes)
      },
      {
        caseId: 'relay-auth-valid',
        path: fixturePath,
        kind: 'fixture',
        applicableComponents: ['cloud', 'hivecode', 'cell'],
        expectedVerdict: 'ACCEPT',
        expectedReason: 'VALID',
        sha256: sha256Bytes(fixtureBytes)
      }
    ]
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(path.join(contractRoot, 'fixture-manifest.json'), manifestBytes)
  const files = [
    { path: 'fixture-manifest.json', sha256: sha256Bytes(manifestBytes) },
    { path: fixturePath, sha256: sha256Bytes(fixtureBytes) },
    { path: 'schemas/relay-auth.schema.json', sha256: sha256Bytes(schemaBytes) }
  ]
  const receipt = {
    schemaVersion: 1,
    authorityRepository: 'hive-cloud',
    authorityPath: 'docs/hive/contracts/hiverelay-v2',
    authoritySourceCommit: 'a'.repeat(40),
    contractRevision: manifest.contractRevision,
    manifestSha256: sha256Bytes(manifestBytes),
    files
  }
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  return { contractRoot, receiptPath, fixturePath, receipt }
}

describe('HiveRelay vendored contract verifier', () => {
  it('rejects duplicate JSON keys instead of accepting last-key-wins input', () => {
    expect(() =>
      parseStrictJsonDocument('{"schemaVersion":1,"schemaVersion":1}', 'receipt')
    ).toThrow('duplicate key schemaVersion')
  })

  it('accepts an exact, content-addressed authority copy', async () => {
    const sandbox = await createContractSandbox()

    const result = await verifyHiveRelayContract(sandbox)

    expect(result.receipt.contractRevision).toBe('hiverelay-v2-p0-r1')
    expect(result.applicableCases.map((fixture) => fixture.caseId)).toEqual(['relay-auth-valid'])
  })

  it('rejects a fixture changed after vendoring', async () => {
    const sandbox = await createContractSandbox()
    await writeFile(path.join(sandbox.contractRoot, sandbox.fixturePath), '{"tampered":true}\n')

    await expect(verifyHiveRelayContract(sandbox)).rejects.toThrow(
      `Vendored contract digest mismatch: ${sandbox.fixturePath}`
    )
  })

  it('rejects unreceipted files in the vendored tree', async () => {
    const sandbox = await createContractSandbox()
    await writeFile(path.join(sandbox.contractRoot, 'untracked.json'), '{}\n')

    await expect(verifyHiveRelayContract(sandbox)).rejects.toThrow(
      'Vendored contract file set does not match receipt'
    )
  })

  it('rejects unsafe or reordered receipt paths before reading files', async () => {
    const sandbox = await createContractSandbox()
    const receipt = JSON.parse(await readFile(sandbox.receiptPath, 'utf8'))
    receipt.files[0].path = '../fixture-manifest.json'
    await writeFile(sandbox.receiptPath, `${JSON.stringify(receipt)}\n`)

    await expect(verifyHiveRelayContract(sandbox)).rejects.toThrow(
      'must be a canonical safe relative path'
    )
  })
})
