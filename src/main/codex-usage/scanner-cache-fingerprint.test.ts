import type * as NodeOs from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as Snapshots from '../usage/jsonl-file-snapshot'
const state = vi.hoisted(() => ({
  home: '',
  fixed: null as Snapshots.JsonlFileSnapshot | null,
  bytes: 0
}))
vi.mock('electron', () => ({ app: { getPath: () => state.home } }))
vi.mock('node:os', async () => ({
  ...(await vi.importActual<typeof NodeOs>('node:os')),
  homedir: () => state.home
}))
vi.mock('../usage/jsonl-file-snapshot', async () => {
  const actual = await vi.importActual<typeof Snapshots>('../usage/jsonl-file-snapshot')
  return {
    ...actual,
    readJsonlFileSnapshot: async (...args: Parameters<typeof actual.readJsonlFileSnapshot>) =>
      state.fixed ?? (await actual.readJsonlFileSnapshot(...args)),
    readJsonlHandleSnapshot: async (...args: Parameters<typeof actual.readJsonlHandleSnapshot>) =>
      state.fixed ?? (await actual.readJsonlHandleSnapshot(...args)),
    readJsonlSnapshotRange: async (...args: Parameters<typeof actual.readJsonlSnapshotRange>) => {
      const result = await actual.readJsonlSnapshotRange(...args)
      state.bytes += result?.length ?? 0
      return result
    }
  }
})
import { readJsonlFileSnapshot } from '../usage/jsonl-file-snapshot'
import { scanCodexUsageFiles } from './scanner'
const previousHome = process.env.CODEX_HOME
const previousData = process.env.ORCA_USER_DATA_PATH
let file: string
beforeEach(() => {
  state.home = mkdtempSync(join(tmpdir(), 'codex-fingerprint-'))
  process.env.ORCA_USER_DATA_PATH = state.home
  process.env.CODEX_HOME = join(state.home, 'codex-runtime-home', 'home')
  mkdirSync(join(process.env.CODEX_HOME, 'sessions'), { recursive: true })
  file = join(process.env.CODEX_HOME, 'sessions', 'rollout.jsonl')
  state.fixed = null
  state.bytes = 0
})
afterEach(() => {
  state.fixed = null
  rmSync(state.home, { recursive: true, force: true })
  if (previousHome === undefined) {
    delete process.env.CODEX_HOME
  } else {
    process.env.CODEX_HOME = previousHome
  }
  if (previousData === undefined) {
    delete process.env.ORCA_USER_DATA_PATH
  } else {
    process.env.ORCA_USER_DATA_PATH = previousData
  }
})
function records(heavy: 'head' | 'tail' | null): string {
  const rows = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'fingerprint', cwd: state.home } })
  ]
  for (let n = 0; n < 60; n++) {
    rows.push(
      JSON.stringify({
        timestamp: `2026-05-26T12:${String(n).padStart(2, '0')}:00.000Z`,
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            model: 'gpt-5-codex',
            last_token_usage: {
              input_tokens: (heavy === 'head' && n === 0) || (heavy === 'tail' && n === 59) ? 3 : 1,
              output_tokens: 0,
              total_tokens: (heavy === 'head' && n === 0) || (heavy === 'tail' && n === 59) ? 3 : 1
            }
          }
        }
      })
    )
  }
  return `${rows.join('\n')}\n`
}
it.each(['head', 'tail'] as const)('rejects equal-generation %s changes', async (part) => {
  const original = records(null),
    replacement = records(part)
  expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(original))
  writeFileSync(file, original)
  state.fixed = await readJsonlFileSnapshot(file)
  const first = await scanCodexUsageFiles([], [])
  expect(first.dailyAggregates.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(60)
  writeFileSync(file, replacement)
  const second = await scanCodexUsageFiles([], first.processedFiles)
  const cold = await scanCodexUsageFiles([], [])
  expect(second.dailyAggregates).toEqual(cold.dailyAggregates)
  expect(second.sessions).toEqual(cold.sessions)
  expect(second.dailyAggregates.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(62)
})
it('keeps matching data cached within the explicit idle byte budget', async () => {
  writeFileSync(file, records(null))
  const first = await scanCodexUsageFiles([], [])
  state.bytes = 0
  const second = await scanCodexUsageFiles([], first.processedFiles)
  expect(second.processedFiles[0]).toBe(first.processedFiles[0])
  expect(state.bytes).toBeGreaterThan(0)
  expect(state.bytes).toBeLessThanOrEqual(8192)
})

it.each([undefined, null, { size: -1, headDigest: '', boundaryDigest: '' }])(
  'parses missing or invalid fingerprint %j',
  async (fingerprint) => {
    writeFileSync(file, records(null))
    const first = await scanCodexUsageFiles([], [])
    first.processedFiles[0].contentFingerprint = fingerprint
    const second = await scanCodexUsageFiles([], first.processedFiles)
    expect(second.processedFiles[0]).not.toBe(first.processedFiles[0])
    expect(second.dailyAggregates).toEqual(first.dailyAggregates)
  }
)
it('round-trips the fingerprint independently of a null resume state', async () => {
  writeFileSync(file, records(null).trimEnd())
  const first = await scanCodexUsageFiles([], [])
  expect(first.processedFiles[0].parseResumeState).toBeNull()
  const previous = JSON.parse(JSON.stringify(first.processedFiles))
  state.bytes = 0
  const second = await scanCodexUsageFiles([], previous)
  expect(second.processedFiles[0]).toBe(previous[0])
  expect(state.bytes).toBeLessThanOrEqual(8192)
  expect(second.dailyAggregates).toEqual(first.dailyAggregates)
})
