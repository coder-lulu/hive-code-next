import { describe, expect, it } from 'vitest'
import { hiveAgentSessionAggregateSchema } from './hive-agent-session-aggregate'
import { hiveAgentGenerationSchema } from './hive-agent-session-schema'

const uuid = 'c45332af-09c6-46c9-a71e-1f2ce0e825ee'
const other = 'c45332af-09c6-46c9-a71e-1f2ce0e825ef'
const sessionId = `ha-session:${uuid}`
const turnId = `ha-turn:${uuid}`
const generationId = `ha-generation:${uuid}`
const bindingId = `ha-binding:${uuid}`
const session = {
  schemaVersion: 1,
  sessionId,
  profileId: 'personal',
  createdAt: 1,
  updatedAt: 2,
  visibility: 'private',
  retention: 'until-deleted',
  stateRevision: 0
}
const aggregate = {
  session: { ...session, activeGenerationId: generationId, backendBindingRef: bindingId },
  binding: {
    schemaVersion: 1,
    bindingId,
    providerKind: 'managed-pi',
    providerSessionRef: 'provider-01',
    runtimeRecordRef: 'runtime_record_01',
    capabilityRevision: 3,
    capabilities: ['local.text']
  },
  turn: {
    schemaVersion: 1,
    turnId,
    sessionId,
    clientOperationId: 'operation_01',
    inputRef: 'journal-item_01',
    state: 'UNKNOWN',
    createdAt: 2
  },
  generation: {
    schemaVersion: 1,
    generationId,
    turnId,
    providerBindingRef: bindingId,
    capabilityRevision: 3,
    modelSelection: {
      modelId: 'vendor/model-a',
      protocol: 'CHAT_COMPLETIONS',
      snapshotRevision: 'a'.repeat(64)
    },
    state: 'UNKNOWN'
  }
}

describe('HiveAgent current aggregate reference integrity', () => {
  it('correlates a durable execution profile and protocol while reading unbound history', () => {
    const executionBinding = {
      schemaVersion: 1,
      packRevision: 'b'.repeat(64),
      profileId: 'personal',
      protocol: 'CHAT_COMPLETIONS',
      toolPolicy: 'empty',
      maxInputTokens: 16_000,
      maxOutputTokens: 2_000
    }
    const bound = { ...aggregate, generation: { ...aggregate.generation, executionBinding } }
    expect(hiveAgentSessionAggregateSchema.parse(bound)).toEqual(bound)
    expect(
      hiveAgentSessionAggregateSchema.safeParse({
        ...bound,
        session: { ...bound.session, profileId: 'other' }
      }).success
    ).toBe(false)
    for (const modelSelection of [
      undefined,
      { ...aggregate.generation.modelSelection, protocol: 'RESPONSES' }
    ]) {
      expect(
        hiveAgentGenerationSchema.safeParse({ ...bound.generation, modelSelection }).success
      ).toBe(false)
    }
    const unbound = { ...aggregate.generation, modelSelection: undefined }
    expect(hiveAgentGenerationSchema.parse(unbound).executionBinding).toBeUndefined()
  })
  it('allows an unbound new session and round-trips a bound current execution', () => {
    expect(hiveAgentSessionAggregateSchema.parse({ session })).toEqual({ session })
    expect(hiveAgentSessionAggregateSchema.parse(JSON.parse(JSON.stringify(aggregate)))).toEqual(
      aggregate
    )
  })

  it.each(['binding', 'turn', 'generation'] as const)('rejects a missing referenced %s', (key) => {
    const broken = { ...aggregate, [key]: undefined }
    expect(hiveAgentSessionAggregateSchema.safeParse(broken).success).toBe(false)
  })

  it('rejects cross-session, turn, binding and capability references', () => {
    const patches = [
      { turn: { ...aggregate.turn, sessionId: `ha-session:${other}` } },
      { generation: { ...aggregate.generation, turnId: `ha-turn:${other}` } },
      { generation: { ...aggregate.generation, providerBindingRef: `ha-binding:${other}` } },
      { generation: { ...aggregate.generation, generationId: `ha-generation:${other}` } },
      { generation: { ...aggregate.generation, capabilityRevision: 4 } },
      { generation: { ...aggregate.generation, state: 'RUNNING' } },
      { binding: { ...aggregate.binding, bindingId: `ha-binding:${other}` } },
      { turn: { ...aggregate.turn, createdAt: 0 } }
    ]
    for (const patch of patches) {
      expect(hiveAgentSessionAggregateSchema.safeParse({ ...aggregate, ...patch }).success).toBe(
        false
      )
    }
  })

  it('rejects unreferenced binding/generation and duplicate history or process authority', () => {
    expect(hiveAgentSessionAggregateSchema.safeParse({ ...aggregate, session }).success).toBe(false)
    for (const field of ['transcript', 'turns', 'lease', 'worktree']) {
      expect(hiveAgentSessionAggregateSchema.safeParse({ ...aggregate, [field]: [] }).success).toBe(
        false
      )
    }
  })
})
