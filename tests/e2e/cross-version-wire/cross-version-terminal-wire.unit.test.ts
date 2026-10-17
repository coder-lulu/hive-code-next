import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TERMINAL_MULTIPLEX_ACK_FLUSH_MS } from '../../../src/shared/terminal-multiplex-flow-control'
import { UPSTREAM_BASELINE_PINS } from '../../../config/scripts/prepare-cross-version-baselines.mjs'
import { comparePublishedFieldOccurrences, publishedFieldNames } from './published-field-shape'
import {
  resolveBaselineReleaseRef,
  resolveReleaseCheckoutCommit,
  selectLatestStableReleaseTag
} from './release-checkout'
import {
  CrossVersionJourneyStall,
  JOURNEY_INPUTS,
  JOURNEY_STEPS,
  runTerminalSkewJourney,
  type JourneyRecord
} from './terminal-skew-journey'
import {
  loadTerminalWireBuild,
  withoutOpcodeSupport,
  WORKING_TREE,
  type TerminalWireBuild
} from './versioned-terminal-wire'

// Why: a cold CI run extracts the baseline checkout before the first journey.
const SUITE_TIMEOUT_MS = 180_000
// Last stable release before SnapshotStart began publishing terminal mode metadata.
// Official v1.4.190; pin the commit so product clones need no upstream release refs.
const TERMINAL_MODE_METADATA_LEGACY_REF = '6e4f817101daa18d82824b69243d9079baa9c416'

/**
 * Mandatory journey frames, named rather than numbered. Flow-credit ACKs may
 * flush before disconnect or be cancelled during disposal; validate them separately
 * without removing them from the observed wire or bypassing peer decoding.
 */
const EXPECTED_JOURNEY_FRAMES = [
  'C>H Subscribe',
  'H>C SnapshotStart',
  'H>C SnapshotChunk',
  'H>C SnapshotEnd',
  'C>H Input',
  'H>C Output',
  'C>H SnapshotRequest',
  'H>C SnapshotStart',
  'H>C SnapshotChunk',
  'H>C SnapshotEnd',
  'C>H Subscribe',
  'H>C SnapshotStart',
  'H>C SnapshotChunk',
  'H>C SnapshotEnd',
  'C>H Input',
  'C>H Unsubscribe'
]
const SNAPSHOT_START_OCCURRENCES = ['initial', 'reveal', 'reconnect'] as const

let baselineRef: string
let current: TerminalWireBuild
let baseline: TerminalWireBuild
/** What a current host publishes to a client of its own version. */
let currentReference: JourneyRecord
/** What the baseline host publishes to a client of its own version. */
let baselineReference: JourneyRecord
let legacyTerminalModeMetadata: TerminalWireBuild

beforeAll(async () => {
  baselineRef = resolveBaselineReleaseRef()
  const [workingTree, baselineRelease, legacyRelease] = await Promise.all([
    loadTerminalWireBuild(WORKING_TREE),
    loadTerminalWireBuild(baselineRef),
    loadTerminalWireBuild(TERMINAL_MODE_METADATA_LEGACY_REF)
  ])
  current = workingTree
  baseline = baselineRelease
  legacyTerminalModeMetadata = legacyRelease
  currentReference = await runTerminalSkewJourney({ hostBuild: current, clientBuild: current })
  baselineReference = await runTerminalSkewJourney({ hostBuild: baseline, clientBuild: baseline })
}, SUITE_TIMEOUT_MS)

afterEach(() => {
  // Each journey installs and removes its own window stub; fail loudly if one leaked.
  expect(typeof globalThis.window).toBe('undefined')
})

function expectJourneyActuallyRan(record: JourneyRecord): void {
  // The anti-vacuous-pass oracle. A harness that connects and then does nothing
  // fails here, because "nothing threw" is never enough to call a pairing green.
  expect(record.completed).toEqual([...JOURNEY_STEPS])
  expectJourneyFrames(record)
  expect(record.subscribedEvents).toHaveLength(2)
  expect(record.snapshotStarts).toHaveLength(3)
  expect(record.missingRuntimeMethods).toEqual([])
}

function expectJourneyFrames(record: JourneyRecord): void {
  expect(record.observed).toHaveLength(record.frameSequence.length)
  const acknowledgements = record.frameSequence.flatMap((name, index) =>
    name === 'C>H Ack' ? [index] : []
  )
  // This script delivers exactly one Output, so at most one credit return is valid.
  expect(acknowledgements.length).toBeLessThanOrEqual(1)
  const outputIndex = record.frameSequence.indexOf('H>C Output')
  const reconnectIndex = record.frameSequence.indexOf('C>H Subscribe', 1)
  for (const index of acknowledgements) {
    const frame = record.observed[index]!
    expect(index).toBeGreaterThan(outputIndex)
    expect(index).toBeLessThan(reconnectIndex)
    expect(frame).toMatchObject({
      direction: 'client-to-host',
      opcode: Number(current.codec.TerminalStreamOpcode.Ack),
      streamId: record.observed[outputIndex]!.streamId,
      seq: 0
    })
    expect(frame.json).toEqual({
      bytes: new TextEncoder().encode(JOURNEY_INPUTS.output).byteLength
    })
  }
  expect(record.frameSequence.filter((name) => name !== 'C>H Ack')).toEqual(EXPECTED_JOURNEY_FRAMES)
}

async function runWithAckSchedule(
  hostBuild: TerminalWireBuild,
  schedule: 'flush' | 'dispose'
): Promise<JourneyRecord> {
  const nativeSet = globalThis.setTimeout
  const nativeClear = globalThis.clearTimeout
  const timers: {
    handle: ReturnType<typeof setTimeout>
    fire: () => void
    cancelled: boolean
    fired: boolean
  }[] = []
  // Hold only the real ACK callback. All host batching, barriers and watchdogs keep
  // their ordinary timers; the receiving codecs and recorded frames are unchanged.
  const set = vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    if (delay !== TERMINAL_MULTIPLEX_ACK_FLUSH_MS) {
      return nativeSet(callback, delay, ...args)
    }
    const handle = Symbol('held ACK timer') as unknown as ReturnType<typeof setTimeout>
    timers.push({ handle, fire: () => callback(...args), cancelled: false, fired: false })
    return handle
  })
  const clear = vi.spyOn(globalThis, 'clearTimeout').mockImplementation((handle) => {
    const timer = timers.find((entry) => entry.handle === handle)
    if (timer) {
      timer.cancelled = true
    } else {
      nativeClear(handle)
    }
  })
  try {
    const record = await runTerminalSkewJourney({
      hostBuild,
      clientBuild: current,
      afterLiveOutput: () => {
        expect(timers).toHaveLength(1)
        expect(timers[0]!.cancelled).toBe(false)
        if (schedule === 'flush') {
          timers[0]!.fired = true
          timers[0]!.fire()
        }
      }
    })
    expect(timers).toHaveLength(1)
    expect(timers[0]).toMatchObject({
      fired: schedule === 'flush',
      cancelled: schedule === 'dispose'
    })
    return record
  } finally {
    set.mockRestore()
    clear.mockRestore()
  }
}

function expectSnapshotStartFieldsRemainPublished(args: {
  older: readonly Record<string, unknown>[]
  newer: readonly Record<string, unknown>[]
  olderLabel: string
  newerLabel: string
}): void {
  const skewByOccurrence = comparePublishedFieldOccurrences(args)
  for (const [index, skew] of skewByOccurrence.entries()) {
    const occurrence = SNAPSHOT_START_OCCURRENCES[index] ?? `occurrence ${index + 1}`
    expect(
      skew.removed,
      `${args.newerLabel} stopped publishing ${occurrence} SnapshotStart fields ` +
        `${args.olderLabel} publishes (it added: ${skew.added.join(', ') || 'nothing'})`
    ).toEqual([])
  }
}

function expectWireCompatible(record: JourneyRecord): void {
  // Rule 2 — no frame may be refused by the receiving build's decoder. An opcode
  // the peer does not know is dropped silently, so this is the only signal.
  expect(record.rejected).toEqual([])
  expect(record.clientErrors).toEqual([])

  // The subscribe handshake still negotiates the optional output-pause opcode,
  // which is what keeps opcode 16 legal to send on this pairing.
  for (const event of record.subscribedEvents) {
    expect(event.capabilities).toEqual({ outputPause: 1 })
  }

  // Input reached the process, before and after the reconnect.
  expect(record.inputAtProcess).toEqual([JOURNEY_INPUTS.first, JOURNEY_INPUTS.second])

  // Rule 3 — what the host publishes, as the client actually rendered it.
  expect(record.snapshotsRendered[0]).toBe(JOURNEY_INPUTS.initialBuffer)
  expect(record.dataRendered.join('')).toBe(JOURNEY_INPUTS.output)
  expect(record.revealSnapshot?.data).toBe(
    `${JOURNEY_INPUTS.initialBuffer}${JOURNEY_INPUTS.output}`
  )
  expect(record.revealSnapshot).toMatchObject({ cols: 120, rows: 40 })
  for (const start of record.snapshotStarts) {
    expect(start).toMatchObject({ kind: 'scrollback', cols: 120, rows: 40, source: 'headless' })
  }
}

describe('cross-version remote terminal wire', () => {
  it('ignores legacy, mobile, and prerelease tags when selecting the baseline', () => {
    expect(
      selectLatestStableReleaseTag([
        'v799',
        'mobile-v9.0.0',
        'v1.4.177-rc.3',
        'v1.4.175',
        'v1.4.176'
      ])
    ).toBe('v1.4.176')
  })

  it(
    'skews current code against a real published release',
    () => {
      const publishedLabel =
        Object.entries(UPSTREAM_BASELINE_PINS).find(
          ([releaseTag, commit]) =>
            commit === baselineRef && selectLatestStableReleaseTag([releaseTag]) === releaseTag
        )?.[0] ?? baselineRef
      expect(selectLatestStableReleaseTag([publishedLabel])).toBe(publishedLabel)
      expect(resolveReleaseCheckoutCommit(publishedLabel)).toBe(baseline.revision)
      if (/^[0-9a-f]{40}$/.test(baselineRef)) {
        expect(baselineRef).toBe(baseline.revision)
      }
      expect(baseline.revision).toMatch(/^[0-9a-f]{40}$/)
      expect(baseline.revision).not.toBe(current.revision)
    },
    SUITE_TIMEOUT_MS
  )

  it('current client against current server completes the journey, and is the reference for a current host', () => {
    expectJourneyActuallyRan(currentReference)
    expectWireCompatible(currentReference)
    expect(currentReference.snapshotStarts).toEqual([
      expect.objectContaining({ alternateScreen: false, terminalOwner: 'shell' }),
      expect.objectContaining({ alternateScreen: false, terminalOwner: 'shell' }),
      expect.objectContaining({ alternateScreen: false, terminalOwner: 'shell' })
    ])
  })

  it('old client against old server completes the journey, and is the reference for an old host', () => {
    expect(baselineReference.hostRevision).toBe(baseline.revision)
    expect(baselineReference.clientRevision).toBe(baseline.revision)
    expectJourneyActuallyRan(baselineReference)
    expectWireCompatible(baselineReference)
    for (const start of baselineReference.snapshotStarts) {
      expect(publishedFieldNames(start).length).toBeGreaterThan(4)
    }
  })

  it(
    'old client against new server completes the journey',
    async () => {
      const record = await runTerminalSkewJourney({ hostBuild: current, clientBuild: baseline })
      expect(record.clientRevision).toBe(baseline.revision)
      expectJourneyActuallyRan(record)
      expectWireCompatible(record)
      expect(record.snapshotStarts).toEqual(currentReference.snapshotStarts)
    },
    SUITE_TIMEOUT_MS
  )

  it(
    'new client against old server completes the journey',
    async () => {
      const record = await runTerminalSkewJourney({ hostBuild: baseline, clientBuild: current })
      expect(record.hostRevision).toBe(baseline.revision)
      expectJourneyActuallyRan(record)
      expectWireCompatible(record)
      expect(record.snapshotStarts).toEqual(baselineReference.snapshotStarts)
    },
    SUITE_TIMEOUT_MS
  )

  it('adds SnapshotStart fields rather than dropping ones the old host still publishes', () => {
    expectSnapshotStartFieldsRemainPublished({
      older: baselineReference.snapshotStarts,
      newer: currentReference.snapshotStarts,
      olderLabel: baselineRef,
      newerLabel: 'current code'
    })
  })

  it('detects a field removed from only the reveal SnapshotStart occurrence', () => {
    const mutated = currentReference.snapshotStarts.map((start) => ({ ...start }))
    const revealIndex = SNAPSHOT_START_OCCURRENCES.indexOf('reveal')
    const reveal = mutated[revealIndex]
    if (!reveal) {
      throw new Error('The terminal journey did not publish a reveal SnapshotStart')
    }
    expect(reveal).toHaveProperty('seq')
    delete reveal.seq
    expect(() =>
      expectSnapshotStartFieldsRemainPublished({
        older: currentReference.snapshotStarts,
        newer: mutated,
        olderLabel: 'current reference',
        newerLabel: 'current mutation'
      })
    ).toThrow(/reveal SnapshotStart fields.*seq/)
  })

  it(
    'still fails a pairing whose peer cannot decode an opcode the other side sends',
    async () => {
      const inputOpcode = Number(current.codec.TerminalStreamOpcode.Input)
      const stall = await runTerminalSkewJourney({
        hostBuild: withoutOpcodeSupport(current, 'Input'),
        clientBuild: current,
        barrierTimeoutMs: 2_000
      }).then(
        () => null,
        (error: unknown) => error
      )
      expect(stall).toBeInstanceOf(CrossVersionJourneyStall)
      const stalled = stall as CrossVersionJourneyStall
      expect(stalled.step).toBe('input-reaches-process')
      expect(stalled.record.completed).not.toContain('input-reaches-process')
      expect(stalled.record.inputAtProcess).toEqual([])
      expect(stalled.record.rejected).toContainEqual(
        expect.objectContaining({ direction: 'client-to-host', rawOpcode: inputOpcode })
      )
    },
    SUITE_TIMEOUT_MS
  )

  it(
    'new client handles a release without terminal mode metadata',
    async () => {
      const record = await runTerminalSkewJourney({
        hostBuild: legacyTerminalModeMetadata,
        clientBuild: current
      })
      expect(record.hostLabel).toBe(TERMINAL_MODE_METADATA_LEGACY_REF)
      expectJourneyActuallyRan(record)
      expectWireCompatible(record)
      for (const start of record.snapshotStarts) {
        expect(start).not.toHaveProperty('terminalOwner')
        expect(start).not.toHaveProperty('alternateScreen')
      }
    },
    SUITE_TIMEOUT_MS
  )

  for (const hostLabel of ['current', 'baseline'] as const) {
    for (const schedule of ['flush', 'dispose'] as const) {
      it(
        `validates the complete journey when ${hostLabel} ACK credit uses the ${schedule} schedule`,
        async () => {
          const record = await runWithAckSchedule(
            hostLabel === 'current' ? current : baseline,
            schedule
          )
          expectJourneyActuallyRan(record)
          expectWireCompatible(record)
          expect(record.frameSequence.filter((name) => name === 'C>H Ack')).toHaveLength(
            schedule === 'flush' ? 1 : 0
          )
        },
        SUITE_TIMEOUT_MS
      )
    }
    it(
      `rejects a ${hostLabel} peer that cannot decode a scheduled ACK`,
      async () => {
        const host = hostLabel === 'current' ? current : baseline
        const record = await runWithAckSchedule(withoutOpcodeSupport(host, 'Ack'), 'flush')
        expectJourneyActuallyRan(record)
        expect(record.rejected).toContainEqual(
          expect.objectContaining({
            direction: 'client-to-host',
            rawOpcode: Number(current.codec.TerminalStreamOpcode.Ack)
          })
        )
        expect(() => expectWireCompatible(record)).toThrow()
      },
      SUITE_TIMEOUT_MS
    )
  }

  it(
    'rejects malformed, duplicate, misplaced ACKs and missing mandatory journey evidence',
    async () => {
      const record = await runWithAckSchedule(baseline, 'flush')
      expectJourneyActuallyRan(record)
      expectWireCompatible(record)
      const ackIndex = record.frameSequence.indexOf('C>H Ack')
      for (const mutate of [
        (r: JourneyRecord) => {
          r.observed[ackIndex]!.json = { bytes: 0 }
        },
        (r: JourneyRecord) => {
          r.observed[ackIndex]!.json = { bytes: 28 }
        },
        (r: JourneyRecord) => {
          r.observed[ackIndex]!.json = { bytes: 27, unexpected: true }
        },
        (r: JourneyRecord) => {
          r.observed[ackIndex]!.streamId += 1
        },
        (r: JourneyRecord) => {
          r.observed[ackIndex]!.seq = 1
        },
        (r: JourneyRecord) => {
          r.observed[ackIndex]!.direction = 'host-to-client'
        },
        (r: JourneyRecord) => {
          r.observed.splice(0, 0, r.observed.splice(ackIndex, 1)[0]!)
          r.frameSequence.splice(0, 0, r.frameSequence.splice(ackIndex, 1)[0]!)
        },
        (r: JourneyRecord) => {
          r.observed.push(r.observed[ackIndex]!)
          r.frameSequence.push('C>H Ack')
        },
        (r: JourneyRecord) => {
          r.observed.splice(4, 1)
          r.frameSequence.splice(4, 1)
        },
        (r: JourneyRecord) => {
          r.completed = []
        }
      ]) {
        const mutated = structuredClone(record)
        mutate(mutated)
        expect(() => expectJourneyActuallyRan(mutated)).toThrow()
      }
    },
    SUITE_TIMEOUT_MS
  )
})
