import * as filesystem from 'node:fs'
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
  hiveGoldenReferences,
  manifestFor,
  upstreamGoldenSha256
} from '../../rpc-foundation/hive-recording-reference'

import {
  CONTROL_PATHS,
  recordingProjection,
  recordingControlProjection
} from '../../../config/scripts/upstream-recording-source.mjs'

vi.mock('./rpc-recording/scenario-input', () => ({
  readScenarios: () => ({
    scenarios: [
      { id: 'b1', operation: 'workspace.file-inventory' },
      { id: 'b2', operation: 'project.update-metadata' }
    ]
  })
}))
vi.mock('./rpc-recording/derived-goldens', () => ({
  derivedGoldens: () => [{ id: 'b1' }, { id: 'b2' }]
}))
vi.mock('./rpc-recording/recorder-digest', () => ({ recorderSha256: () => 'b'.repeat(64) }))
vi.mock('./rpc-recording/scenario-digest', () => ({ scenarioSha256: () => 'c'.repeat(64) }))
vi.mock('./rpc-recording/adapter-digest', () => ({ adapterSha256: () => 'd'.repeat(64) }))

const project = resolve(import.meta.dirname, '../../..')
const upstream = join(project, 'mobile/rpc-foundation/goldens')
const logs = join(project, 'logs/upstream-sync-20260915/overlay-tests')
mkdirSync(logs, { recursive: true })
const upstreamBaseline = 'a781a602a8729439d7a3eebf0c3b9e5817362e77'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

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
  mkdirSync(join(root, 'config/scripts'), { recursive: true })
  for (const path of CONTROL_PATHS.filter(
    (path) => path.startsWith('config/scripts/') && path.endsWith('.mjs')
  )) {
    writeFileSync(join(root, path), readFileSync(join(project, path)))
  }
  git('init', '--quiet')
  git('config', 'core.autocrlf', 'false')
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
  const projection = recordingProjection(root, baseline)
  const sourcePin = {
    kind: 'tree-sync-content',
    controlSha: baseline,
    upstreamSha: upstreamBaseline,
    guardVersion: 1,
    guardedSourcesSha256: projection.guardedSourcesSha256,
    guardedFileCount: projection.guardedFileCount
  }
  const sourceInput = join(root, 'source-input.json')
  writeFileSync(
    sourceInput,
    JSON.stringify({
      source: sourcePin,
      projection,
      controlProjection: recordingControlProjection(root, baseline)
    })
  )
  writeFileSync(
    join(root, 'provenance.json'),
    JSON.stringify({
      source: sourcePin,
      recorderSha256: 'b'.repeat(64),
      scenariosSha256: 'c'.repeat(64),
      adapterSha256ByOperation: Object.fromEntries(
        next.map((golden) => [golden.operation, 'd'.repeat(64)])
      )
    })
  )
  return { root, reference, hive, recorded, originals, next, baseline, source, sourceInput }
}

describe('Hive recording provenance and sparse overlays', { timeout: 30_000 }, () => {
  it('retains unchanged upstream traces and publishes only the reviewed product trace', () => {
    const f = fixture()
    const upstreamBytes = readFileSync(join(f.reference, 'b2.json'), 'utf8')
    mkdirSync(join(f.hive, 'goldens'), { recursive: true })
    writeFileSync(join(f.hive, 'goldens/stale.json'), '{}')
    writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)
    expect(existsSync(join(f.hive, 'goldens/b1.json'))).toBe(false)
    expect(existsSync(join(f.hive, 'goldens/b2.json'))).toBe(true)
    expect(existsSync(join(f.hive, 'goldens/stale.json'))).toBe(false)
    expect(readFileSync(join(f.reference, 'b2.json'), 'utf8')).toBe(upstreamBytes)
    expect(readGolden(f.reference, 'b1')).toEqual(f.next[0])
    expect(readGolden(f.reference, 'b2')).toEqual(f.next[1])
    expect(JSON.parse(readFileSync(join(f.hive, 'manifest.json'), 'utf8')).version).toBe(3)
  })

  it('rejects a missing supported recording instead of silently shrinking the domain', () => {
    const f = fixture()
    rmSync(join(f.recorded, 'b1.json'))

    expect(() => writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)).toThrow(
      'complete current product-supported recording domain'
    )
  })

  it('rejects an unreviewed trace before publishing a provenance manifest', () => {
    const f = fixture(false)
    expect(() => writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)).toThrow(
      'Unreviewed Hive recording difference'
    )
    expect(existsSync(join(f.hive, 'manifest.json'))).toBe(false)
  })

  it('rejects an altered upstream reference rather than silently accepting it as product output', () => {
    const f = fixture()
    writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)
    writeFileSync(join(f.reference, 'b1.json'), '{}')
    expect(() => readGolden(f.reference, 'b2')).toThrow('frozen upstream reference')
  })

  it('rejects a changed product overlay even when its header still names the candidate', () => {
    const f = fixture()
    writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)
    writeFileSync(join(f.hive, 'goldens/b2.json'), goldenBytes(f.next[0]))
    expect(() => readGolden(f.reference, 'b2')).toThrow('overlay changed without review')
  })
})

describe('raw source projection fences the writer', { timeout: 30_000 }, () => {
  it('rejects source drift before generating outputs', () => {
    const f = fixture()
    writeFileSync(join(f.source, 'product.ts'), 'changed')
    expect(() => writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)).toThrow(
      'bytes differ'
    )
  })
  it('rejects extra guarded modules', () => {
    const f = fixture()
    writeFileSync(join(f.source, 'extra.ts'), 'changed')
    expect(() => writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)).toThrow(
      'paths differ'
    )
  })
  it('rejects altered reviewed deltas after writing', () => {
    const f = fixture()
    writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)
    writeFileSync(join(f.hive, 'reviewed-deltas.json'), '{}')
    expect(() => readGolden(f.reference, 'b2')).toThrow('reviewed deltas')
  })
})

describe('bounded Hive recording batch', { timeout: 30_000 }, () => {
  it('validates the whole corpus twice rather than once per materialized reference', () => {
    const f = fixture()
    writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)
    manifestFor(f.reference)
    const reads = vi.mocked(filesystem.readdirSync)
    reads.mockClear()
    const ids = ['b1', 'b2', 'b1', 'b2']
    expect(hiveGoldenReferences(f.reference, ids, readGoldenRaw)).toEqual([
      f.next[0],
      f.next[1],
      f.next[0],
      f.next[1]
    ])
    expect(reads.mock.calls.filter(([directory]) => directory === f.reference)).toHaveLength(2)
  })

  it.each(['upstream', 'manifest', 'reviewed-deltas'])(
    'rejects %s drift during a batch',
    (kind) => {
      const f = fixture()
      writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)
      let changed = false
      const read = (directory: string, id: string) => {
        const golden = readGoldenRaw(directory, id)
        if (!changed) {
          changed = true
          if (kind === 'manifest') {
            const file = join(f.hive, 'manifest.json')
            const manifest = JSON.parse(readFileSync(file, 'utf8'))
            manifest.source.upstreamSha = 'f'.repeat(40)
            writeFileSync(file, JSON.stringify(manifest))
          } else {
            const file =
              kind === 'upstream'
                ? join(f.reference, 'b1.json')
                : join(f.hive, 'reviewed-deltas.json')
            writeFileSync(file, readFileSync(file, 'utf8') + ' ')
          }
        }
        return golden
      }
      expect(() => hiveGoldenReferences(f.reference, ['b1', 'b2'], read)).toThrow()
    }
  )

  it('keeps the per-entry overlay hash and decoded value checks', () => {
    const f = fixture()
    writeHiveRecordingOverlay(f.root, f.sourceInput, f.recorded, f.hive)
    const read = (directory: string, id: string) => {
      const golden = readGoldenRaw(directory, id)
      if (id === 'b1') {
        writeFileSync(join(f.hive, 'goldens/b2.json'), goldenBytes(f.next[0]))
      }
      return golden
    }
    expect(() => hiveGoldenReferences(f.reference, ['b1', 'b2'], read)).toThrow(
      'overlay changed without review'
    )
  })
})
