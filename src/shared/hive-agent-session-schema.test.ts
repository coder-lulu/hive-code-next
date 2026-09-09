import { describe, expect, expectTypeOf, it } from 'vitest'
import { isAgentSessionId } from './agent-session-record'
import {
  hiveAgentBindingIdSchema,
  hiveAgentBindingSchema,
  hiveAgentGenerationIdSchema,
  hiveAgentGenerationSchema,
  hiveAgentSessionErrorSchema,
  hiveAgentSessionIdSchema,
  hiveAgentSessionSchema,
  hiveAgentTurnIdSchema,
  hiveAgentTurnSchema,
  type HiveAgentBindingId,
  type HiveAgentGenerationId,
  type HiveAgentSessionId,
  type HiveAgentTurnId
} from './hive-agent-session-schema'

const uuid = 'c45332af-09c6-46c9-a71e-1f2ce0e825ee'
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
  activeGenerationId: generationId,
  backendBindingRef: bindingId,
  stateRevision: 0
}
const binding = {
  schemaVersion: 1,
  bindingId,
  providerKind: 'managed-pi',
  providerSessionRef: uuid,
  runtimeRecordRef: 'runtime_record_01',
  capabilityRevision: 0,
  capabilities: ['local.text']
}

describe('HiveAgent product schema', () => {
  it('keeps all four ID domains distinct at runtime and compile time', () => {
    const schemas = [
      hiveAgentSessionIdSchema,
      hiveAgentTurnIdSchema,
      hiveAgentGenerationIdSchema,
      hiveAgentBindingIdSchema
    ]
    const ids = [sessionId, turnId, generationId, bindingId]
    schemas.forEach((schema, i) =>
      ids.forEach((id, j) => {
        expect(schema.safeParse(id).success).toBe(i === j)
      })
    )
    for (const id of ids) {
      expect(isAgentSessionId(id)).toBe(false)
    }
    expectTypeOf<HiveAgentSessionId>().not.toEqualTypeOf<HiveAgentTurnId>()
    expectTypeOf<HiveAgentSessionId>().not.toEqualTypeOf<HiveAgentGenerationId>()
    expectTypeOf<HiveAgentSessionId>().not.toEqualTypeOf<HiveAgentBindingId>()
  })

  it.each([
    uuid,
    'runtime_record_01',
    'relay-connection-01',
    `${sessionId}suffix`,
    ` ${sessionId}`,
    `${sessionId}\n`,
    'ha-session:../../secret',
    null,
    1
  ])('rejects malformed or foreign session identity %#', (value) => {
    expect(hiveAgentSessionIdSchema.safeParse(value).success).toBe(false)
  })

  it('round-trips JSON objects without persisting a second history or process lease', () => {
    const turn = {
      schemaVersion: 1,
      turnId,
      sessionId,
      clientOperationId: 'operation_01',
      inputRef: 'journal-item_01',
      state: 'UNKNOWN',
      createdAt: 1
    }
    const generation = {
      schemaVersion: 1,
      generationId,
      turnId,
      providerBindingRef: bindingId,
      capabilityRevision: 0,
      state: 'UNKNOWN'
    }
    expect(hiveAgentSessionSchema.parse(JSON.parse(JSON.stringify(session)))).toEqual(session)
    expect(hiveAgentTurnSchema.parse(JSON.parse(JSON.stringify(turn)))).toEqual(turn)
    expect(hiveAgentGenerationSchema.parse(JSON.parse(JSON.stringify(generation)))).toEqual(
      generation
    )
    expect(hiveAgentBindingSchema.parse(JSON.parse(JSON.stringify(binding)))).toEqual(binding)
    expect(hiveAgentSessionSchema.safeParse({ ...session, lease: {} }).success).toBe(false)
    expect(hiveAgentTurnSchema.safeParse({ ...turn, transcript: [] }).success).toBe(false)
  })

  it('rejects future versions, invalid revisions and unsupported policy/capabilities', () => {
    for (const patch of [
      { schemaVersion: 2 },
      { stateRevision: -1 },
      { stateRevision: Infinity },
      { updatedAt: 0 },
      { visibility: 'public' },
      { retention: 'forever' },
      { activeGenerationId: turnId }
    ]) {
      expect(hiveAgentSessionSchema.safeParse({ ...session, ...patch }).success).toBe(false)
    }
    expect(
      hiveAgentBindingSchema.safeParse({ ...binding, runtimeRecordRef: sessionId }).success
    ).toBe(false)
    expect(
      hiveAgentBindingSchema.safeParse({ ...binding, capabilities: ['local.coding'] }).success
    ).toBe(false)
  })

  it('rejects empty, oversized and control-character references', () => {
    for (const value of ['', 'x'.repeat(513), 'ref\n', 'ref\t', 'ref\u0000', 'ref\u007f']) {
      expect(
        hiveAgentBindingSchema.safeParse({ ...binding, encryptedSecretRef: value }).success
      ).toBe(false)
    }
    expect(
      hiveAgentBindingSchema.safeParse({ ...binding, encryptedSecretRef: 'x'.repeat(512) }).success
    ).toBe(true)
  })

  it('rejects a turn finalized before creation', () => {
    expect(
      hiveAgentTurnSchema.safeParse({
        schemaVersion: 1,
        turnId,
        sessionId,
        clientOperationId: 'operation_01',
        inputRef: 'journal-item_01',
        state: 'COMPLETED',
        createdAt: 2,
        finalizedAt: 1
      }).success
    ).toBe(false)
  })

  it('accepts reference fields and stable errors, rejecting raw credential fields', () => {
    expect(
      hiveAgentBindingSchema.parse({ ...binding, encryptedSecretRef: 'credential_01' })
        .encryptedSecretRef
    ).toBe('credential_01')
    expect(hiveAgentBindingSchema.safeParse({ ...binding, apiKey: 'fake-secret' }).success).toBe(
      false
    )
    expect(hiveAgentSessionErrorSchema.parse({ code: 'hive_agent_outcome_unknown' })).toEqual({
      code: 'hive_agent_outcome_unknown'
    })
    expect(
      hiveAgentSessionErrorSchema.safeParse({
        code: 'hive_agent_outcome_unknown',
        message: 'fake-secret'
      }).success
    ).toBe(false)
  })
})
