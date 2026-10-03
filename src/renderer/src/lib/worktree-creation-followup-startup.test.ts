import { describe, expect, it, vi } from 'vitest'
import {
  needsPostCreateAgentStartup,
  prepareBackendFollowupStartup
} from './worktree-creation-followup-startup'

describe('backend follow-up startup', () => {
  it('shares one launch token between backend spawn and prompt delivery', () => {
    const createLaunchToken = vi.fn(() => 'launch-token')
    const request = {
      startup: { command: 'goose', env: { GOOSE_MODE: 'auto' } },
      startupPlan: {
        agent: 'goose' as const,
        launchCommand: 'goose',
        expectedProcess: 'goose',
        followupPrompt: 'implement the task',
        launchConfig: { agentArgs: '', agentEnv: { GOOSE_MODE: 'auto' } }
      }
    }

    prepareBackendFollowupStartup(request, createLaunchToken)

    expect(request.startup).toMatchObject({ launchToken: 'launch-token' })
    expect(request.startupPlan).toMatchObject({ launchToken: 'launch-token' })
    expect(needsPostCreateAgentStartup(request, true)).toBe(true)
  })

  it('does not re-deliver a self-contained backend launch', () => {
    expect(
      needsPostCreateAgentStartup(
        {
          startupPlan: {
            agent: 'codex',
            launchCommand: "codex 'implement the task'",
            expectedProcess: 'codex',
            followupPrompt: null,
            launchConfig: { agentArgs: '', agentEnv: {} }
          }
        },
        true
      )
    ).toBe(false)
  })

  it('shares the launch token for a backend agent that needs a draft paste', () => {
    const request = {
      startup: { command: 'codex' },
      startupPlan: {
        agent: 'codex' as const,
        launchCommand: 'codex',
        expectedProcess: 'codex',
        followupPrompt: null,
        draftPrompt: 'review this change',
        launchConfig: { agentArgs: '', agentEnv: {} }
      }
    }

    prepareBackendFollowupStartup(request, () => 'draft-launch-token')

    expect(request.startup).toMatchObject({ launchToken: 'draft-launch-token' })
    expect(request.startupPlan).toMatchObject({ launchToken: 'draft-launch-token' })
    expect(needsPostCreateAgentStartup(request, true)).toBe(true)
  })
})
