import { describe, expect, it } from 'vitest'
import { resolveMobileSourceControlLaunchAgent } from './mobile-source-control-launch-agent'

const recipe = {
  agentId: 'claude',
  commandInputTemplate: 'Fix: {basePrompt}',
  agentArgs: '--model opus'
}
function context(disabledTuiAgents: string[] = []) {
  return {
    settings: {
      defaultTuiAgent: 'codex',
      disabledTuiAgents,
      sourceControlAi: { enabled: true, actions: { resolveConflicts: recipe } }
    },
    detectedAgents: ['claude', 'codex'],
    repo: null
  }
}

describe('current mobile source-control action recipes', () => {
  it('uses sourceControlAi action agent and literal recipe fields', () => {
    expect(resolveMobileSourceControlLaunchAgent(context(), 'resolveConflicts')).toEqual({
      kind: 'agent',
      agent: 'claude',
      recipe
    })
  })
  it('honors a repo sourceControlAi override over the global recipe', () => {
    const repo = {
      id: 'repo-1',
      sourceControlAi: {
        actionOverrides: {
          resolveConflicts: { agentId: 'codex', agentArgs: '--model "literal model"' }
        }
      }
    }
    expect(
      resolveMobileSourceControlLaunchAgent({ ...context(), repo }, 'resolveConflicts')
    ).toEqual({
      kind: 'agent',
      agent: 'codex',
      recipe: { ...recipe, agentId: 'codex', agentArgs: '--model "literal model"' }
    })
  })
  it.each(['disabled', 'undetected'])(
    'refuses the saved %s agent without silently substituting the default',
    (reason) => {
      const input = context(reason === 'disabled' ? ['claude'] : [])
      if (reason === 'undetected') {
        input.detectedAgents = ['codex']
      }
      expect(resolveMobileSourceControlLaunchAgent(input, 'resolveConflicts')).toEqual({
        kind: 'unavailable',
        message: 'The saved agent for this action is not available on this workspace host.'
      })
    }
  )
  it('uses the default when launching without a recipe', () => {
    expect(resolveMobileSourceControlLaunchAgent(context(), null)).toEqual({
      kind: 'agent',
      agent: 'codex',
      recipe: null
    })
  })
})
