import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { openHiveRuntimeRelayOutbox } from './hive-runtime-relay-storage'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'hive-relay-storage-'))
  roots.push(root)
  return root
}
function context(): CurrentHiveRuntimeCloudLeaseContext {
  return {
    authorityId: 'authority-1',
    identity: {} as CurrentHiveRuntimeCloudLeaseContext['identity'],
    tuple: {
      runtimeRecordId: 'record-1',
      runtimeInstanceId: 'runtime-1',
      bootId: randomUUID(),
      heartbeatLeaseId: 'lease-1',
      authorityGeneration: 1,
      leaseEpoch: 1,
      fencingEpoch: 1
    }
  }
}
function pending(directory: string, scope = context()) {
  const outbox = openHiveRuntimeRelayOutbox(directory, scope)
  outbox.enqueue({
    transitionType: 'ACTIVATE',
    managedSessionId: 'managed-1',
    runtimeSessionId: 'session-1',
    expectedControlVersion: 1,
    sessionBindingHash: 'A'.repeat(43),
    occurredAt: Date.now(),
    reason: 'ACTIVATED'
  })
  outbox.close()
  return scope
}

it('retires fenced boots across more than eight restarts with bounded evidence and no fake ACK', () => {
  const path = directory()
  for (let index = 0; index < 12; index++) {
    pending(path)
  }
  const files = readdirSync(path)
  expect(files.filter((name) => name.endsWith('.outbox.json'))).toHaveLength(1)
  const receipt = JSON.parse(readFileSync(join(path, 'boot-retirement.json'), 'utf8'))
  expect(receipt.retiredCount).toBe(11)
  expect(receipt.retiredPayloadCount).toBe(11)
  expect(receipt.latest.payloadDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(receipt)).not.toMatch(/APPLIED|stored|sessionBindingHash/)
})

it('validates all old files before retirement and rejects corrupt receipt or another runtime record', () => {
  const path = directory()
  pending(path)
  const receiptPath = join(path, 'boot-retirement.json')
  const original = readFileSync(receiptPath, 'utf8')
  const current = context()
  const different = { ...current, tuple: { ...current.tuple, runtimeRecordId: 'other-record' } }
  expect(() => openHiveRuntimeRelayOutbox(path, different)).toThrow('scope_mismatch')
  const outboxPath = join(
    path,
    readdirSync(path).find((name) => name.endsWith('.outbox.json'))!
  )
  writeFileSync(outboxPath, '{}')
  expect(() => openHiveRuntimeRelayOutbox(path, context())).toThrow('corrupt')
  expect(readFileSync(receiptPath, 'utf8')).toBe(original)
  writeFileSync(receiptPath, '{}')
  expect(() => openHiveRuntimeRelayOutbox(path, context())).toThrow('retirement_corrupt')
})

it('refuses a symlinked storage directory', () => {
  const path = directory()
  const target = directory()
  const link = join(path, 'linked')
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  expect(() => openHiveRuntimeRelayOutbox(link, context())).toThrow('storage_unsafe')
  expect(readdirSync(target)).toEqual([])
})

it('resumes a persisted retirement before unlink without recounting or changing the payload evidence', () => {
  const path = directory()
  pending(path)
  const name = readdirSync(path).find((entry) => entry.endsWith('.outbox.json'))!
  const payload = readFileSync(join(path, name), 'utf8')
  const next = context()
  openHiveRuntimeRelayOutbox(path, next).close()
  const receiptPath = join(path, 'boot-retirement.json')
  const receipt = readFileSync(receiptPath, 'utf8')
  // Simulate process death after durable receipt and before unlink.
  writeFileSync(join(path, name), payload)
  openHiveRuntimeRelayOutbox(path, next).close()
  expect(readFileSync(receiptPath, 'utf8')).toBe(receipt)
  expect(readdirSync(path)).toEqual(['boot-retirement.json'])
})
