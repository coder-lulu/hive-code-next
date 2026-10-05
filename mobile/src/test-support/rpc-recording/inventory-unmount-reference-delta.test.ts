import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { familyGoldens } from './derived-goldens'
import { compareGolden, goldenBytes, goldenRecording, readGolden } from './golden-recording'
import {
  INVENTORY_UNMOUNT_REFERENCE_ID,
  inventoryUnmountExpectedReference
} from './inventory-unmount-reference-delta'
import { pilotMountAdapters } from './pilot-mount-adapters'
import { runRecording, runRecordingMutant } from './run-recording'
import { readScenarios } from './scenario-input'
import { vitestRecordingScheduler } from './vitest-recording-scheduler'
import type { GoldenRecording } from './golden-recording'
import type { Recording } from './recording-scenario'

const root = resolve(import.meta.dirname, '../../../..')
const directory = resolve(root, 'mobile/rpc-foundation/goldens')
const reference = readGolden(directory, INVENTORY_UNMOUNT_REFERENCE_ID)
const expected = inventoryUnmountExpectedReference(reference)
const prefix = 'inventory-lifecycle.unmount-before-1:'
const guardPath = resolve(root, 'mobile/src/session/use-mobile-native-chat-file-search.ts')
const guardSource = readFileSync(guardPath)
const guard = '          if (!mountedRef.current) {\n            return\n          }\n'

function frozenBytes() {
  return [directory, resolve(root, 'mobile/rpc-foundation/hive')].flatMap((folder) =>
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = resolve(entry.parentPath, entry.name)
        return [path, createHash('sha256').update(readFileSync(path)).digest('hex')]
      })
  )
}
const before = frozenBytes()
afterAll(() => {
  expect(frozenBytes()).toEqual(before)
  expect(readFileSync(guardPath)).toEqual(guardSource)
})

function checkpoint(golden: GoldenRecording, id = `${prefix}settled`) {
  const result = golden.recording.checkpoints.find((item) => item.id === id)
  if (!result) {
    throw new Error(`Missing checkpoint ${id}`)
  }
  return result
}

function variant(recording: Recording, id: string): Recording {
  const variantPrefix = `${id}:`
  const checkpoints = recording.checkpoints
    .filter((item) => item.id.startsWith(variantPrefix))
    .map((item) => ({ ...item, id: item.id.slice(variantPrefix.length) }))
  if (!checkpoints.length) {
    throw new Error(`Missing variant ${id}`)
  }
  return { scenario: id, checkpoints }
}

const manifest = readScenarios(resolve(root, 'mobile/rpc-foundation/pilot-scenarios.json'))
const lifecycle = familyGoldens(manifest.scenarios).find(
  (item) => item.id === INVENTORY_UNMOUNT_REFERENCE_ID
)
if (!lifecycle) {
  throw new Error('Missing inventory lifecycle family')
}
const scenarios = lifecycle.scenarios()
const unmounted = scenarios.find((item) => item.id === prefix.slice(0, -1))
if (!unmounted) {
  throw new Error('Missing unmounted inventory scenario')
}

it('keeps the exact original object and adapts only two late request and payload pairs', () => {
  const bytes = readFileSync(resolve(directory, `${INVENTORY_UNMOUNT_REFERENCE_ID}.json`))
  expect(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')).toBe(
    '8784dc311689a91a5724b7a8835b8cae7ed8c51d'
  )
  expect(createHash('sha256').update(goldenBytes(reference)).digest('hex')).toBe(
    'db551fcf4cb3566ba0fbefeeffb9e7ccbf937e10eaebb6702c52c4bcc1f63440'
  )
  expect(expected.recording.checkpoints).toHaveLength(28)
  expect(scenarios).toHaveLength(12)
  const restored = structuredClone(expected)
  for (const suffix of ['settled', 'remounted']) {
    const id = `${prefix}${suffix}`
    const old = checkpoint(reference, id).observation
    const current = checkpoint(expected, id).observation
    if (!Array.isArray(old.sender) || !Array.isArray(old.payloads)) {
      throw new Error('Missing original late request')
    }
    expect(current).toEqual({
      ...old,
      sender: old.sender.slice(0, 1),
      payloads: old.payloads.slice(0, 1)
    })
    checkpoint(restored, id).observation = structuredClone(old)
  }
  expect(restored).toEqual(reference)
  expect(goldenBytes(restored)).toBe(goldenBytes(reference))
})

for (const scenario of scenarios.filter((item) => item.id !== unmounted.id)) {
  it(`${scenario.id}: preserves every field and the canonical encoding`, () => {
    const original = goldenRecording([scenario], variant(reference.recording, scenario.id))
    const adapted = goldenRecording([scenario], variant(expected.recording, scenario.id))
    compareGolden(original, adapted)
    expect(goldenBytes(adapted)).toBe(goldenBytes(original))
    const tampered = structuredClone(adapted)
    tampered.recording.checkpoints[0]!.observation.effects = ['unexpected-effect']
    expect(() => compareGolden(adapted, tampered)).toThrow('Recording differs')
  })
}

const changes: { name: string; change: (golden: GoldenRecording) => void }[] = [
  {
    name: 'identity',
    change: (golden) => {
      golden.recording.scenario = 'different-inventory'
    }
  },
  {
    name: 'operation',
    change: (golden) => {
      golden.operation = 'other.operation'
    }
  },
  {
    name: 'family',
    change: (golden) => {
      golden.family = 'other-family'
    }
  },
  {
    name: 'named delta',
    change: (golden) => {
      golden.namedDeltas.push('unreviewed')
    }
  },
  {
    name: 'params',
    change: (golden) => {
      checkpoint(golden).observation.sender = [{ args: ['wrong-worktree'] }]
    }
  },
  {
    name: 'payload',
    change: (golden) => {
      checkpoint(golden).observation.payloads = [{ json: 'wrong-frame' }]
    }
  },
  {
    name: 'state',
    change: (golden) => {
      checkpoint(golden).observation.state = { files: ['wrong.ts'] }
    }
  },
  {
    name: 'effects',
    change: (golden) => {
      checkpoint(golden).observation.effects = ['unexpected-effect']
    }
  },
  {
    name: 'settlements',
    change: (golden) => {
      checkpoint(golden).observation.settlements = { status: 'pending' }
    }
  },
  {
    name: 'checkpoint ID',
    change: (golden) => {
      checkpoint(golden).id = `${prefix}different`
    }
  },
  {
    name: 'missing checkpoint',
    change: (golden) => {
      golden.recording.checkpoints.pop()
    }
  },
  {
    name: 'checkpoint order',
    change: (golden) => {
      golden.recording.checkpoints.reverse()
    }
  }
]
for (const { name, change } of changes) {
  it(`refuses a changed frozen ${name} instead of adapting another reference`, () => {
    const changed = structuredClone(reference)
    change(changed)
    expect(() => inventoryUnmountExpectedReference(changed)).toThrow(
      'differs from its approved original'
    )
  })
  it(`rejects changed actual ${name} without normalizing the product output`, () => {
    const changed = structuredClone(expected)
    change(changed)
    const originalBytes = goldenBytes(changed)
    expect(() => compareGolden(expected, changed)).toThrow('Recording differs')
    expect(goldenBytes(changed)).toBe(originalBytes)
  })
}

it('strictly rejects the old late files.list sender and payload in actual output', () => {
  expect(() => compareGolden(expected, reference)).toThrow('Recording differs')
})

it('the current mounted owner matches the approved source delta before mutation', async () => {
  const { adapters } = pilotMountAdapters(root, { device: unmounted })
  const actual = await runRecording(
    unmounted,
    adapters[unmounted.operation],
    vitestRecordingScheduler()
  )
  compareGolden(
    goldenRecording([unmounted], variant(expected.recording, unmounted.id)),
    goldenRecording([unmounted], actual)
  )
  for (const item of actual.checkpoints.filter((item) =>
    ['settled', 'remounted'].includes(item.id)
  )) {
    expect(item.observation.sender).toHaveLength(1)
    expect(item.observation.payloads).toHaveLength(1)
  }
}, 30_000)

it('applies the real unmount guard mutant once and kills its late inventory admission', async () => {
  expect(guardSource.toString('utf8').replaceAll('\r\n', '\n').split(guard)).toHaveLength(2)
  const { adapters, assertMutationApplied } = pilotMountAdapters(root, {
    device: unmounted,
    mutation: {
      name: 'closed-owner-late-inventory',
      file: 'use-mobile-native-chat-file-search.ts',
      before: guard,
      after: ''
    }
  })
  const baseline = variant(expected.recording, unmounted.id)
  const result = await runRecordingMutant(
    unmounted,
    adapters[unmounted.operation],
    vitestRecordingScheduler(),
    baseline
  )
  assertMutationApplied()
  expect(result.verdict).toBe('killed')
  expect(result.recording.checkpoints.map((item) => item.id)).toEqual(
    baseline.checkpoints.map((item) => item.id)
  )
  const lateCheckpoints = result.recording.checkpoints.filter((item) =>
    ['settled', 'remounted'].includes(item.id)
  )
  expect(lateCheckpoints).toHaveLength(2)
  for (const item of lateCheckpoints) {
    const original = baseline.checkpoints.find((candidate) => candidate.id === item.id)
    expect(item.observation.state).toEqual(original?.observation.state)
    expect(item.observation.effects).toEqual(original?.observation.effects)
    expect(item.observation.settlements).toEqual(original?.observation.settlements)
    expect(item.observation.sender).toHaveLength(2)
    expect(item.observation.payloads).toHaveLength(2)
    expect(item.observation.sender).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'files.list#1', ordinal: 3 })])
    )
    expect(item.observation.payloads).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'files.list#1', ordinal: 4 })])
    )
  }
  expect(() =>
    compareGolden(
      goldenRecording([unmounted], variant(expected.recording, unmounted.id)),
      goldenRecording([unmounted], result.recording)
    )
  ).toThrow('Recording differs')
}, 30_000)
