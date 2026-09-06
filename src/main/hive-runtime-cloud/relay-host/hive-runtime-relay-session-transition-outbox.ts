import { randomUUID } from 'node:crypto'
import {
  readHiveRuntimeServiceOwnedJson,
  writeHiveRuntimeServiceOwnedJson
} from '../hive-runtime-cloud-service-owned-json'
import {
  hiveRuntimeRelayTransitionDigest,
  isHiveRuntimeRelaySessionTransition,
  isHiveRuntimeRelayTransitionAdjudication,
  isHiveRuntimeRelayTransitionState,
  transitionInteger,
  transitionObject,
  validTransitionIdentity
} from './hive-runtime-relay-session-transition-validation'
import type {
  HiveRuntimeRelaySessionTransition,
  HiveRuntimeRelayTransitionAcknowledgement,
  HiveRuntimeRelayTransitionHandle,
  HiveRuntimeRelayTransitionInput,
  HiveRuntimeRelayTransitionSettlement,
  HiveRuntimeRelayTransitionState
} from './hive-runtime-relay-session-transition-types'

export type {
  HiveRuntimeRelayTransitionAcknowledgement,
  HiveRuntimeRelayTransitionInput,
  HiveRuntimeRelayTransitionSettlement
} from './hive-runtime-relay-session-transition-types'

const MAXIMUM_BYTES = 1_048_576
type Failure =
  | 'invalid_input'
  | 'corrupt'
  | 'scope_mismatch'
  | 'full'
  | 'write_failed'
  | 'replay_conflict'
  | 'sequence_gap'
  | 'closed'
export class HiveRuntimeRelayTransitionOutboxError extends Error {
  constructor(readonly code: Failure) {
    super(`Hive Runtime transition outbox: ${code}`)
    this.name = 'HiveRuntimeRelayTransitionOutboxError'
  }
}

export class HiveRuntimeRelaySessionTransitionOutbox {
  private state: HiveRuntimeRelayTransitionState
  private readonly path: string
  private readonly maximumEntries: number
  private fault: Failure | null = null
  private needsCursorInitialization: boolean
  private readonly completions = new Map<
    string,
    (value: HiveRuntimeRelayTransitionSettlement) => void
  >()

  constructor(options: {
    path: string
    runtimeId: string
    runtimeBootId: string
    maximumEntries?: number
  }) {
    this.path = options.path
    this.maximumEntries = options.maximumEntries ?? 256
    if (
      !validTransitionIdentity(options.runtimeId, options.runtimeBootId) ||
      !Number.isSafeInteger(this.maximumEntries) ||
      this.maximumEntries < 1 ||
      this.maximumEntries > 1024
    ) {
      throw new HiveRuntimeRelayTransitionOutboxError('invalid_input')
    }
    const read = readHiveRuntimeServiceOwnedJson(
      this.path,
      isHiveRuntimeRelayTransitionState,
      MAXIMUM_BYTES
    )
    if (read.status === 'unreadable') {
      throw new HiveRuntimeRelayTransitionOutboxError('corrupt')
    }
    this.needsCursorInitialization = read.status === 'missing'
    this.state =
      read.status === 'ok'
        ? read.value
        : {
            version: 'hiverelay-session-transition-outbox/v1',
            runtimeId: options.runtimeId,
            runtimeBootId: options.runtimeBootId,
            nextSequence: 1,
            highestAck: 0,
            entries: []
          }
    if (
      this.state.runtimeId !== options.runtimeId ||
      this.state.runtimeBootId !== options.runtimeBootId
    ) {
      throw new HiveRuntimeRelayTransitionOutboxError('scope_mismatch')
    }
    if (this.state.entries.length > this.maximumEntries) {
      throw new HiveRuntimeRelayTransitionOutboxError('full')
    }
  }

  get pendingCount(): number {
    return this.state.entries.length
  }
  get canAccept(): boolean {
    return this.fault === null && this.pendingCount < this.maximumEntries
  }

  /** Seed a fresh boot from its verified empty heartbeat; never acknowledge pending payloads. */
  initializeCursor(value: HiveRuntimeRelayTransitionAcknowledgement): void {
    this.assertHealthy()
    if (!this.needsCursorInitialization) {
      return
    }
    if (
      this.state.nextSequence !== 1 ||
      this.state.highestAck !== 0 ||
      this.state.entries.length !== 0 ||
      !transitionObject(value) ||
      Object.keys(value).length !== 2 ||
      !transitionInteger(value.ackedSessionTransitionSequence) ||
      value.ackedSessionTransitionSequence >= Number.MAX_SAFE_INTEGER ||
      !Array.isArray(value.sessionTransitionResults) ||
      value.sessionTransitionResults.length !== 0
    ) {
      return this.fail('invalid_input')
    }
    this.persist({
      ...this.state,
      highestAck: value.ackedSessionTransitionSequence,
      nextSequence: value.ackedSessionTransitionSequence + 1
    })
  }

  enqueue(input: HiveRuntimeRelayTransitionInput): HiveRuntimeRelayTransitionHandle {
    this.assertHealthy()
    if (
      this.pendingCount >= this.maximumEntries ||
      this.state.nextSequence === Number.MAX_SAFE_INTEGER
    ) {
      throw new HiveRuntimeRelayTransitionOutboxError('full')
    }
    const transition = { ...input, sequence: this.state.nextSequence, transitionId: randomUUID() }
    if (
      !isHiveRuntimeRelaySessionTransition(transition) ||
      !transitionObject(input) ||
      Object.keys(input).length !== 7
    ) {
      throw new HiveRuntimeRelayTransitionOutboxError('invalid_input')
    }
    const next = structuredClone(this.state)
    next.entries.push({ transition, payloadSha256: hiveRuntimeRelayTransitionDigest(transition) })
    next.nextSequence++
    this.persist(next)
    const completion = new Promise<HiveRuntimeRelayTransitionSettlement>((resolve) => {
      this.completions.set(transition.transitionId, resolve)
    })
    return { transition: structuredClone(transition), completion }
  }

  snapshot(limit = 128): readonly HiveRuntimeRelaySessionTransition[] {
    this.assertHealthy()
    if (!Number.isInteger(limit) || limit < 1 || limit > 128) {
      throw new HiveRuntimeRelayTransitionOutboxError('invalid_input')
    }
    return this.state.entries.slice(0, limit).map((entry) => structuredClone(entry.transition))
  }

  acknowledge(
    value: HiveRuntimeRelayTransitionAcknowledgement
  ): readonly HiveRuntimeRelayTransitionSettlement[] {
    this.assertHealthy()
    if (
      !transitionObject(value) ||
      Object.keys(value).length !== 2 ||
      !transitionInteger(value.ackedSessionTransitionSequence) ||
      value.ackedSessionTransitionSequence >= this.state.nextSequence ||
      !Array.isArray(value.sessionTransitionResults) ||
      value.sessionTransitionResults.length > 128 ||
      !value.sessionTransitionResults.every(isHiveRuntimeRelayTransitionAdjudication)
    ) {
      return this.fail('invalid_input')
    }
    const next = structuredClone(this.state)
    const first = next.nextSequence - next.entries.length
    const seen = new Set<number>()
    for (const result of value.sessionTransitionResults) {
      if (seen.has(result.sequence) || result.sequence >= next.nextSequence) {
        return this.fail('replay_conflict')
      }
      seen.add(result.sequence)
      if (result.sequence < first) {
        continue
      }
      const entry = next.entries[result.sequence - first]
      if (
        entry.transition.transitionId !== result.transitionId ||
        (entry.result &&
          Object.keys(entry.result).some(
            (key) =>
              entry.result![key as keyof typeof result] !== result[key as keyof typeof result]
          ))
      ) {
        return this.fail('replay_conflict')
      }
      if (!result.stored) {
        if (result.verdict === 'SEQUENCE_GAP') {
          throw new HiveRuntimeRelayTransitionOutboxError('sequence_gap')
        }
        return this.fail('replay_conflict')
      }
      if (
        result.verdict === 'APPLIED' &&
        entry.transition.transitionType === 'ACTIVATE' &&
        (result.resultingStatus !== 'ACTIVE' ||
          result.resultingControlVersion <= entry.transition.expectedControlVersion)
      ) {
        return this.fail('replay_conflict')
      }
      entry.result = structuredClone(result)
    }
    next.highestAck = Math.max(next.highestAck, value.ackedSessionTransitionSequence)
    const settled: HiveRuntimeRelayTransitionSettlement[] = []
    while (next.entries[0]?.result && next.entries[0].transition.sequence <= next.highestAck) {
      const entry = next.entries.shift()!
      settled.push({
        transition: entry.transition,
        result: entry.result!,
        activationEligible:
          this.completions.has(entry.transition.transitionId) &&
          entry.transition.transitionType === 'ACTIVATE' &&
          entry.result!.verdict === 'APPLIED'
      })
    }
    this.persist(next)
    for (const settlement of settled) {
      this.completions.get(settlement.transition.transitionId)?.(structuredClone(settlement))
      this.completions.delete(settlement.transition.transitionId)
    }
    return structuredClone(settled)
  }

  close(): void {
    this.fault = 'closed'
    this.completions.clear()
  }

  private assertHealthy(): void {
    if (this.fault) {
      throw new HiveRuntimeRelayTransitionOutboxError(this.fault)
    }
  }
  private fail(code: Failure): never {
    this.fault = code
    throw new HiveRuntimeRelayTransitionOutboxError(code)
  }
  private persist(next: HiveRuntimeRelayTransitionState): void {
    if (!writeHiveRuntimeServiceOwnedJson(this.path, next, MAXIMUM_BYTES)) {
      this.fail('write_failed')
    }
    this.state = structuredClone(next)
    this.needsCursorInitialization = false
  }
}
