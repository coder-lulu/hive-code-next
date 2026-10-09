import { describe, it, expect } from 'vitest'
import { buildAgentStartupPlan } from './tui-agent-startup'
import { resolveTuiAgentLaunchArgs } from './tui-agent-launch-defaults'

describe('retained product contract', () => {
  it('launches Devin with stdin-after-start prompt delivery', () => {
    const plan = buildAgentStartupPlan({
      agent: 'devin',
      prompt: 'fix the tests',
      cmdOverrides: {},
      agentArgs: resolveTuiAgentLaunchArgs('devin', null),
      platform: 'linux'
    })
    expect(plan).toEqual({
      agent: 'devin',
      launchCommand: "devin '--permission-mode' 'bypass'",
      expectedProcess: 'devin',
      followupPrompt: 'fix the tests',
      launchConfig: {
        agentCommand: "devin '--permission-mode' 'bypass'",
        agentArgs: '--permission-mode bypass',
        agentEnv: {}
      }
    })
  })
})
