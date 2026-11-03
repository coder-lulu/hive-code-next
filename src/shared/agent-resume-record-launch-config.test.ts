import { describe, expect, it } from 'vitest'
import { copyLaunchConfig } from './agent-resume-record-from-status'
import { launchConfigsEqual } from './agent-resume-record-equivalence'
import type { SleepingAgentLaunchConfig } from './agent-session-resume'

describe('resume launch configuration authority', () => {
  it('preserves explicit host defaults and typed permissions while cloning mutable environment', () => {
    const source: SleepingAgentLaunchConfig = {
      agentArgs: '--verbose',
      agentEnv: { TEST: 'value' },
      hostDefaultsAuthoritative: true,
      agentPermissionMode: 'manual'
    }
    const copied = copyLaunchConfig(source)
    expect(copied).toEqual(source)
    expect(copied.agentEnv).not.toBe(source.agentEnv)
    expect(launchConfigsEqual(copied, source)).toBe(true)
    expect(launchConfigsEqual(copied, { ...source, agentPermissionMode: 'yolo' })).toBe(false)
    expect(launchConfigsEqual(copied, { ...source, hostDefaultsAuthoritative: undefined })).toBe(
      false
    )
  })
})
