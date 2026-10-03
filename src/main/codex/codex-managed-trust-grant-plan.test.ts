import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildExpectedEntries,
  findLedgerGrant,
  type CodexManagedTrustGrantPlan
} from './codex-managed-trust-grant-plan'
import { upsertHookTrustEntriesInContent } from './config-toml-trust'
const { readLedger } = vi.hoisted(() => ({ readLedger: vi.fn() }))
vi.mock('./codex-trust-grant-host', () => ({
  readCodexTrustGrantLedgerHomeMatchingStamp: readLedger
}))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
  vi.clearAllMocks()
})
function fixture(enabled?: boolean) {
  const base = resolve('logs/upstream-sync/review-20260930/tests')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'hook-trust-'))
  roots.push(root)
  const plan: CodexManagedTrustGrantPlan = {
    runtimeHomePath: root,
    tomlPath: join(root, 'config.toml'),
    managedCommand: 'hive managed hook',
    managedEntries: [
      {
        sourcePath: join(root, 'hooks.json'),
        eventLabel: 'stop',
        groupIndex: 0,
        handlerIndex: 0,
        command: 'hive managed hook',
        timeoutSec: 20,
        ...(enabled === undefined ? {} : { enabled })
      }
    ],
    host: { kind: 'native' },
    telemetryLane: 'real-home'
  }
  const expected = buildExpectedEntries(plan)
  readLedger.mockReturnValue({
    binary: null,
    entries: Object.fromEntries(
      expected.map((e) => [e.normalizedKey, { signature: e.signature, trustedHash: 'codex-hash' }])
    )
  })
  return { plan, expected }
}
describe('managed Codex hook ledger state', () => {
  it('rejects a matching hash when the managed hook has been disabled', () => {
    const { plan, expected } = fixture()
    writeFileSync(
      plan.tomlPath,
      upsertHookTrustEntriesInContent(
        '',
        plan.managedEntries.map((e) => ({ ...e, enabled: false, trustedHash: 'codex-hash' }))
      )
    )
    const bytes = readFileSync(plan.tomlPath, 'utf8')
    expect(findLedgerGrant(plan, expected, null)).toBeNull()
    expect(readFileSync(plan.tomlPath, 'utf8')).toBe(bytes)
  })
  it('accepts enabled managed hooks without altering an unrelated disabled user hook', () => {
    const { plan, expected } = fixture()
    const user = {
      ...plan.managedEntries[0],
      handlerIndex: 1,
      command: 'user hook',
      enabled: false,
      trustedHash: 'user-hash'
    }
    writeFileSync(
      plan.tomlPath,
      upsertHookTrustEntriesInContent('', [
        ...plan.managedEntries.map((e) => ({ ...e, enabled: true, trustedHash: 'codex-hash' })),
        user
      ])
    )
    const bytes = readFileSync(plan.tomlPath, 'utf8')
    expect(findLedgerGrant(plan, expected, null)).toHaveLength(1)
    expect(readFileSync(plan.tomlPath, 'utf8')).toBe(bytes)
  })
  it('honors an explicitly disabled expected entry', () => {
    const { plan, expected } = fixture(false)
    writeFileSync(
      plan.tomlPath,
      upsertHookTrustEntriesInContent(
        '',
        plan.managedEntries.map((e) => ({ ...e, trustedHash: 'codex-hash' }))
      )
    )
    expect(findLedgerGrant(plan, expected, null)).toHaveLength(1)
  })
})
