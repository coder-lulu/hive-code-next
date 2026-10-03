import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { goldenBytes, readGolden, readGoldenRaw } from './rpc-recording/golden-recording'
import {
  recordingTraceSha256,
  writeHiveRecordingOverlay
} from '../../rpc-foundation/write-hive-recording-overlay'
import {
  hiveRecordingBaseline,
  upstreamGoldenSha256
} from '../../rpc-foundation/hive-recording-reference'

const project = resolve(import.meta.dirname, '../../..')
const upstream = join(project, 'mobile/rpc-foundation/goldens')
const logs = join(project, 'logs/upstream-sync-20260915/overlay-tests')
mkdirSync(logs, { recursive: true })
const upstreamBaseline = 'a781a602a8729439d7a3eebf0c3b9e5817362e77'

afterEach(() => vi.unstubAllEnvs())

function fixture(reviewed = true) {
  const root = mkdtempSync(join(logs, 'case-'))
  const reference = join(root, 'mobile/rpc-foundation/goldens')
  const hive = join(root, 'mobile/rpc-foundation/hive')
  const recorded = join(root, 'recorded')
  for (const directory of [reference, hive, recorded]) {
    mkdirSync(directory, { recursive: true })
  }
  const originals = ['b1', 'b2'].map((id) => readGoldenRaw(upstream, id))
  const next = originals.map((golden) => structuredClone(golden))
  next[1].recording.checkpoints.at(-1)!.observation.state = { reviewed: 'Hive state' }
  for (const [index, id] of ['b1', 'b2'].entries()) {
    writeFileSync(join(reference, `${id}.json`), goldenBytes(originals[index]))
    writeFileSync(join(recorded, `${id}.json`), goldenBytes(next[index]))
  }
  writeFileSync(
    join(hive, 'reviewed-deltas.json'),
    JSON.stringify({
      upstreamGoldensSha256: upstreamGoldenSha256(reference),
      deltas: reviewed
        ? {
            b2: {
              upstreamTraceSha256: recordingTraceSha256(originals[1]),
              hiveTraceSha256: recordingTraceSha256(next[1]),
              reason: 'Explicitly reviewed fixture state change'
            }
          }
        : {}
    })
  )
  const source = join(root, 'mobile/src')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'product.ts'), 'export const product = 1\n')
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true
    }).trim()
  git('init', '--quiet')
  git('add', '.')
  git(
    '-c',
    'user.name=Recording Test',
    '-c',
    'user.email=recording@example.invalid',
    '-c',
    'core.hooksPath=',
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    'recording source'
  )
  const baseline = git('rev-parse', 'HEAD')
  writeFileSync(
    join(root, 'provenance.json'),
    JSON.stringify({
      baseline,
      upstreamBaseline,
      recorderSha256: 'b'.repeat(64),
      scenariosSha256: 'c'.repeat(64),
      adapterSha256ByOperation: Object.fromEntries(
        next.map((golden) => [golden.operation, 'd'.repeat(64)])
      )
    })
  )
  return { root, reference, hive, recorded, originals, next, baseline, source }
}

describe('Hive recording provenance and sparse overlays', { timeout: 30_000 }, () => {
  it('retains unchanged upstream traces and publishes only the reviewed product trace', () => {
    const f = fixture()
    const upstreamBytes = readFileSync(join(f.reference, 'b2.json'), 'utf8')
    mkdirSync(join(f.hive, 'goldens'), { recursive: true })
    writeFileSync(join(f.hive, 'goldens/stale.json'), '{}')
    writeHiveRecordingOverlay(f.root, f.baseline, f.recorded)
    expect(existsSync(join(f.hive, 'goldens/b1.json'))).toBe(false)
    expect(existsSync(join(f.hive, 'goldens/b2.json'))).toBe(true)
    expect(existsSync(join(f.hive, 'goldens/stale.json'))).toBe(false)
    expect(readFileSync(join(f.reference, 'b2.json'), 'utf8')).toBe(upstreamBytes)
    expect(readGolden(f.reference, 'b1')).toEqual(f.next[0])
    expect(readGolden(f.reference, 'b2')).toEqual(f.next[1])
    expect(hiveRecordingBaseline(f.root, upstreamBaseline)).toBe(f.baseline)
  })

  it('publishes the product-supported subset without changing the frozen upstream set', () => {
    const f = fixture()
    rmSync(join(f.recorded, 'b1.json'))

    writeHiveRecordingOverlay(f.root, f.baseline, f.recorded)

    const manifest = JSON.parse(readFileSync(join(f.hive, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest.adapterSha256ByOperation)).toEqual([f.next[1].operation])
    expect(existsSync(join(f.hive, 'goldens/b2.json'))).toBe(true)
    expect(readFileSync(join(f.reference, 'b1.json'), 'utf8')).toBeTruthy()
  })

  it('rejects an unreviewed trace before publishing a provenance manifest', () => {
    const f = fixture(false)
    expect(() => writeHiveRecordingOverlay(f.root, f.baseline, f.recorded)).toThrow(
      'Unreviewed Hive recording difference'
    )
    expect(existsSync(join(f.hive, 'manifest.json'))).toBe(false)
  })

  it('rejects an altered upstream reference rather than silently accepting it as product output', () => {
    const f = fixture()
    writeHiveRecordingOverlay(f.root, f.baseline, f.recorded)
    writeFileSync(join(f.reference, 'b1.json'), '{}')
    expect(() => hiveRecordingBaseline(f.root, upstreamBaseline)).toThrow(
      'frozen upstream reference'
    )
  })

  it('rejects a changed product overlay even when its header still names the candidate', () => {
    const f = fixture()
    writeHiveRecordingOverlay(f.root, f.baseline, f.recorded)
    writeFileSync(join(f.hive, 'goldens/b2.json'), goldenBytes(f.next[0]))
    expect(() => readGolden(f.reference, 'b2')).toThrow('overlay changed without review')
  })
})

describe('new Hive recording source proof', { timeout: 30_000 }, () => {
  function sourceFixture() {
    const f = fixture()
    writeHiveRecordingOverlay(f.root, f.baseline, f.recorded)
    // A newly synchronized upstream must invalidate playback of the old manifest.
    writeFileSync(join(f.reference, 'b1.json'), '{}')
    return f
  }

  it('records a proven clean commit while stale manifest playback remains refused', () => {
    const f = sourceFixture()
    vi.stubEnv('RPC_FOUNDATION_RECORD', '1')
    vi.stubEnv('RPC_FOUNDATION_MODE', '--record')
    expect(hiveRecordingBaseline(f.root, f.baseline)).toBe(f.baseline)
    vi.stubEnv('RPC_FOUNDATION_MODE', '--candidate')
    expect(() => hiveRecordingBaseline(f.root, f.baseline)).toThrow('frozen upstream reference')
    expect(() => readGolden(f.reference, 'b2')).toThrow('frozen upstream reference')
  })

  it('rejects record mode without explicit write authorization or an existing full commit', () => {
    const f = sourceFixture()
    vi.stubEnv('RPC_FOUNDATION_MODE', '--record')
    vi.stubEnv('RPC_FOUNDATION_RECORD', undefined)
    expect(() => hiveRecordingBaseline(f.root, f.baseline)).toThrow('RPC_FOUNDATION_RECORD=1')
    vi.stubEnv('RPC_FOUNDATION_RECORD', '1')
    expect(() => hiveRecordingBaseline(f.root, 'HEAD')).toThrow('full source commit SHA')
    expect(() => hiveRecordingBaseline(f.root, '0'.repeat(40))).toThrow('existing commit')
  })

  it('rejects tracked source drift even in explicit record mode', () => {
    const f = sourceFixture()
    vi.stubEnv('RPC_FOUNDATION_MODE', '--record')
    vi.stubEnv('RPC_FOUNDATION_RECORD', '1')
    writeFileSync(join(f.source, 'product.ts'), 'export const product = 2\n')
    expect(() => hiveRecordingBaseline(f.root, f.baseline)).toThrow('sources differ')
  })

  it('rejects untracked source modules instead of accepting an unchanged Git diff', () => {
    const f = sourceFixture()
    vi.stubEnv('RPC_FOUNDATION_MODE', '--record')
    vi.stubEnv('RPC_FOUNDATION_RECORD', '1')
    writeFileSync(join(f.source, 'untracked.ts'), 'export const product = 2\n')
    expect(() => hiveRecordingBaseline(f.root, f.baseline)).toThrow('Untracked product sources')
  })
})
