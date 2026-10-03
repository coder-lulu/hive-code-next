import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

describe('Orca Runtime Cloud status', () => {
  it('publishes the claimed Runtime record identity through status.get source data', () => {
    const runtime = new OrcaRuntimeService(null, undefined, {
      getRuntimeRecordId: () => '723e4567-e89b-42d3-a456-426614174000'
    })

    expect(runtime.getStatus().runtimeRecordId).toBe('723e4567-e89b-42d3-a456-426614174000')
  })

  it('omits a record identity for an anonymous local Runtime', () => {
    const runtime = new OrcaRuntimeService(null, undefined, { getRuntimeRecordId: () => null })

    expect(runtime.getStatus()).not.toHaveProperty('runtimeRecordId')
  })
})
