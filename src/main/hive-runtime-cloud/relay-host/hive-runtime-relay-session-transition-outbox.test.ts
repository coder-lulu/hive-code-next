import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { HiveRuntimeRelaySessionTransitionOutbox } from './hive-runtime-relay-session-transition-outbox'
import type {
  HiveRuntimeRelaySessionTransition,
  HiveRuntimeRelayTransitionAdjudication,
  HiveRuntimeRelayTransitionInput
} from './hive-runtime-relay-session-transition-types'

const roots: string[] = []
const boot = '11111111-1111-4111-8111-111111111111'
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
function fixture(maximumEntries = 256) {
  const root = mkdtempSync(join(tmpdir(), 'hive-transition-'))
  roots.push(root)
  const options = {
    path: join(root, 'outbox.json'),
    runtimeId: 'runtime-1',
    runtimeBootId: boot,
    maximumEntries
  }
  return { options, outbox: new HiveRuntimeRelaySessionTransitionOutbox(options) }
}
function input(): HiveRuntimeRelayTransitionInput {
  return {
    transitionType: 'ACTIVATE',
    managedSessionId: 'managed-1',
    runtimeSessionId: 'session-1',
    expectedControlVersion: 3,
    sessionBindingHash: 'A'.repeat(43),
    occurredAt: 1893456000000,
    reason: 'ACTIVATED'
  }
}
function applied(
  transition: HiveRuntimeRelaySessionTransition
): HiveRuntimeRelayTransitionAdjudication {
  return {
    sequence: transition.sequence,
    transitionId: transition.transitionId,
    verdict: 'APPLIED',
    stored: true,
    resultingStatus: 'ACTIVE',
    resultingControlVersion: 4
  }
}

describe('Hive Runtime durable session transition outbox', () => {
  it('retains exact restart payload and never lets recovered ACTIVATE activate an old socket', async () => {
    const { outbox, options } = fixture()
    const handle = outbox.enqueue(input())
    const original = outbox.snapshot()
    outbox.acknowledge({
      ackedSessionTransitionSequence: 0,
      sessionTransitionResults: [applied(handle.transition)]
    })
    outbox.close()
    const restarted = new HiveRuntimeRelaySessionTransitionOutbox(options)
    expect(restarted.snapshot()).toEqual(original)
    const settled = restarted.acknowledge({
      ackedSessionTransitionSequence: 1,
      sessionTransitionResults: []
    })
    expect(settled).toHaveLength(1)
    expect(settled[0].activationEligible).toBe(false)
    expect(new HiveRuntimeRelaySessionTransitionOutbox(options).snapshot()).toEqual([])
    const abandon = restarted.enqueue({
      ...input(),
      expectedControlVersion: 4,
      transitionType: 'ABANDON',
      reason: 'ABANDONED_BEFORE_ACTIVATION'
    })
    expect(abandon.transition.sequence).toBe(2)
    expect(restarted.snapshot()[0].transitionType).toBe('ABANDON')
  })

  it('requires both independent ACK and result before durably resolving the current socket waiter', async () => {
    const { outbox, options } = fixture()
    const handle = outbox.enqueue(input())
    let notified = false
    void handle.completion.then(() => {
      notified = true
    })
    expect(
      outbox.acknowledge({ ackedSessionTransitionSequence: 1, sessionTransitionResults: [] })
    ).toEqual([])
    await Promise.resolve()
    expect(notified).toBe(false)
    expect(outbox.snapshot()).toHaveLength(1)
    outbox.acknowledge({
      ackedSessionTransitionSequence: 1,
      sessionTransitionResults: [applied(handle.transition)]
    })
    expect(await handle.completion).toMatchObject({
      activationEligible: true,
      result: { verdict: 'APPLIED' }
    })
    expect(JSON.parse(readFileSync(options.path, 'utf8')).entries).toEqual([])
  })

  it.each(['wrong-id', 'replay-conflict', 'gap', 'impossible-applied'] as const)(
    'does not delete or mutate persisted data on %s',
    (scenario) => {
      const { outbox, options } = fixture()
      const { transition } = outbox.enqueue(input())
      const before = readFileSync(options.path, 'utf8')
      let result = applied(transition)
      if (scenario === 'wrong-id') {
        result = { ...result, transitionId: randomUUID() }
      }
      if (scenario === 'replay-conflict') {
        result = { ...result, stored: false, verdict: 'TRANSITION_REPLAY_CONFLICT' }
      }
      if (scenario === 'gap') {
        result = { ...result, stored: false, verdict: 'SEQUENCE_GAP' }
      }
      if (scenario === 'impossible-applied') {
        result = { ...result, resultingStatus: 'CLOSED' }
      }
      expect(() =>
        outbox.acknowledge({
          ackedSessionTransitionSequence: 1,
          sessionTransitionResults: [result]
        })
      ).toThrow()
      expect(readFileSync(options.path, 'utf8')).toBe(before)
    }
  )

  it('bounds capacity without losing sequences and does not mistake a stored rejection for activation', async () => {
    const { outbox } = fixture(1)
    const handle = outbox.enqueue(input())
    expect(outbox.canAccept).toBe(false)
    expect(() => outbox.enqueue(input())).toThrow('full')
    outbox.acknowledge({
      ackedSessionTransitionSequence: 1,
      sessionTransitionResults: [
        { ...applied(handle.transition), verdict: 'REJECTED_DEADLINE', resultingStatus: 'EXPIRED' }
      ]
    })
    expect((await handle.completion).activationEligible).toBe(false)
    expect(outbox.enqueue(input()).transition.sequence).toBe(2)
  })

  it('rejects secret-bearing input and fails closed on corrupted digest, version or runtime scope', () => {
    const { outbox, options } = fixture()
    expect(() =>
      outbox.enqueue({
        ...input(),
        ticketSecret: 'do-not-persist-canary'
      } as HiveRuntimeRelayTransitionInput)
    ).toThrow()
    outbox.enqueue(input())
    const original = JSON.parse(readFileSync(options.path, 'utf8'))
    expect(readFileSync(options.path, 'utf8')).not.toContain('do-not-persist-canary')
    expect(
      () => new HiveRuntimeRelaySessionTransitionOutbox({ ...options, runtimeBootId: randomUUID() })
    ).toThrow('scope_mismatch')
    for (const mutate of [
      (state: typeof original) => {
        state.version = 'legacy'
      },
      (state: typeof original) => {
        state.entries[0].transition.expectedControlVersion++
      }
    ]) {
      const changed = structuredClone(original)
      mutate(changed)
      writeFileSync(options.path, JSON.stringify(changed))
      expect(() => new HiveRuntimeRelaySessionTransitionOutbox(options)).toThrow('corrupt')
    }
  })

  it('never returns an accepted transition when its atomic write cannot complete', () => {
    const { options } = fixture()
    const parent = join(roots.at(-1)!, 'file-not-directory')
    writeFileSync(parent, '')
    const outbox = new HiveRuntimeRelaySessionTransitionOutbox({
      ...options,
      path: join(parent, 'outbox.json')
    })
    expect(() => outbox.enqueue(input())).toThrow('write_failed')
    expect(outbox.canAccept).toBe(false)
  })
})
