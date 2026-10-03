import { describe, expect, it } from 'vitest'
import { resolveQuickCreationLaunchPrompt } from './quick-creation-launch-prompt'

describe('resolveQuickCreationLaunchPrompt', () => {
  it('keeps a home-authored task when no work item is linked', () => {
    expect(
      resolveQuickCreationLaunchPrompt({
        linkedWorkItem: null,
        agentPrompt: '  implement the task  ',
        note: 'workspace note'
      })
    ).toEqual({ prompt: 'implement the task', draftPrompt: null })
  })

  it('does not turn an ordinary workspace note into an agent prompt', () => {
    expect(
      resolveQuickCreationLaunchPrompt({
        linkedWorkItem: null,
        agentPrompt: '',
        note: 'workspace note'
      })
    ).toEqual({ prompt: '', draftPrompt: null })
  })

  it('combines a home-authored task with linked work-item context', () => {
    const result = resolveQuickCreationLaunchPrompt({
      linkedWorkItem: {
        provider: 'github',
        number: 42,
        url: 'https://github.com/acme/repo/issues/42',
        title: 'Fix startup'
      },
      agentPrompt: 'implement the task',
      note: 'workspace note'
    })

    expect(result.prompt).toBe('')
    expect(result.draftPrompt).toContain('implement the task')
    expect(result.draftPrompt).toContain('https://github.com/acme/repo/issues/42')
  })
})
