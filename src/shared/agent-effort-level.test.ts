import { describe, expect, it } from 'vitest'
import { readAgentEffortLevel } from './agent-effort-level'

describe('current provider effort identifiers', () => {
  it.each(['low', 'high', 'max-effort', 'provider-level-7', 'a'.repeat(32)])(
    'preserves the actual provider value %s',
    (value) => {
      expect(readAgentEffortLevel(value)).toBe(value)
    }
  )
  it.each([
    undefined,
    null,
    1,
    {},
    [],
    '',
    'High',
    '--permission',
    ' high',
    'high\n',
    'high effort',
    'high;command',
    'a'.repeat(33)
  ])('rejects malformed option input %j', (value) => {
    expect(readAgentEffortLevel(value)).toBeUndefined()
  })
})
