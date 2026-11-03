import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../shared/constants'
vi.mock('./structured-agent-shell-environment', () => ({
  resolveHostAgentBaseEnvironment: async () => ({ BASE_ENV: 'base' }),
  refreshHostAgentBaseEnvironmentAfterMiss: vi.fn()
}))
import { resolveHostStructuredAgentLaunchEnvironment } from './structured-agent-launch-support'

describe('current structured launch profile at the runtime boundary', () => {
  it('retains user environment when the full typed settings profile reaches the launch', async () => {
    const settings = getDefaultSettings('/hive-current-profile')
    settings.agentDefaultEnv = { claude: { USER_CHOICE: 'kept' } }
    expect(await resolveHostStructuredAgentLaunchEnvironment('claude', settings)).toEqual({
      BASE_ENV: 'base',
      USER_CHOICE: 'kept'
    })
  })
})
