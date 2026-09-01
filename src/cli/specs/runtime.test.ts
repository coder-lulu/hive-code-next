import { describe, expect, it } from 'vitest'
import { effectiveAllowedFlags } from '../args'
import { formatCommandHelp } from '../help'
import { RUNTIME_COMMAND_SPECS } from './runtime'

describe('runtime command specs', () => {
  it('keeps ownership commands local and free of browser page targeting', () => {
    for (const spec of RUNTIME_COMMAND_SPECS) {
      expect(effectiveAllowedFlags(spec)).not.toContain('page')
      expect(formatCommandHelp(spec)).not.toContain('--page')
    }
  })

  it('does not expose a claim mode that can abandon an in-memory challenge', () => {
    const claim = RUNTIME_COMMAND_SPECS.find((spec) => spec.path.join(' ') === 'runtime claim')!
    expect(effectiveAllowedFlags(claim)).not.toContain('no-wait')
    expect(formatCommandHelp(claim)).not.toContain('--no-wait')
  })
})
