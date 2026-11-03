import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import { sourceControlActionRecipeMatchesTarget } from './source-control-action-recipe-match'

function settings(): GlobalSettings {
  const base = getDefaultSettings('/tmp')
  return {
    ...base,
    sourceControlAi: {
      ...base.sourceControlAi!,
      enabled: true,
      agentId: 'codex',
      actions: {
        resolveConflicts: {
          agentId: 'codex',
          commandInputTemplate: '{basePrompt}',
          agentArgs: '--model sonnet'
        }
      }
    }
  }
}

describe('sourceControlActionRecipeMatchesTarget', () => {
  it('does not match a forged retired launch default as a saved current recipe', () => {
    const currentSettings = settings()
    const forgedSettings = {
      ...currentSettings,
      sourceControlAi: {
        ...currentSettings.sourceControlAi!,
        actions: {},
        launchActionDefaults: {
          resolveConflicts: { agentId: 'codex', agentArgs: '--model sonnet' }
        }
      }
    }
    expect(
      sourceControlActionRecipeMatchesTarget({
        actionId: 'resolveConflicts',
        target: { type: 'global' },
        recipe: {
          agentId: 'codex',
          commandInputTemplate: '{basePrompt}',
          agentArgs: '--model sonnet'
        },
        settings: forgedSettings
      })
    ).toBe(false)
  })

  it('requires the current custom provider command to match as well as its recipe', () => {
    const currentSettings = settings()
    const recipe = {
      agentId: 'custom',
      commandInputTemplate: '{basePrompt}',
      agentArgs: '--quiet'
    } as const
    currentSettings.sourceControlAi = {
      ...currentSettings.sourceControlAi!,
      customAgentCommand: 'custom-writer --prompt {prompt}',
      actions: { commitMessage: recipe }
    }
    const input = {
      actionId: 'commitMessage',
      target: { type: 'global' },
      recipe,
      settings: currentSettings
    } as const
    expect(
      sourceControlActionRecipeMatchesTarget({ ...input, customAgentCommand: 'other-writer' })
    ).toBe(false)
    expect(
      sourceControlActionRecipeMatchesTarget({
        ...input,
        customAgentCommand: 'custom-writer --prompt {prompt}'
      })
    ).toBe(true)
  })

  it('returns true when the launch recipe matches the global saved recipe', () => {
    expect(
      sourceControlActionRecipeMatchesTarget({
        actionId: 'resolveConflicts',
        target: { type: 'global' },
        recipe: {
          agentId: 'codex',
          commandInputTemplate: '{basePrompt}',
          agentArgs: '--model sonnet'
        },
        settings: settings()
      })
    ).toBe(true)
  })

  it('returns false when the repo target has no saved override yet', () => {
    expect(
      sourceControlActionRecipeMatchesTarget({
        actionId: 'resolveConflicts',
        target: { type: 'repo', repoId: 'repo-1' },
        recipe: {
          agentId: 'codex',
          commandInputTemplate: '{basePrompt}',
          agentArgs: '--model sonnet'
        },
        settings: settings(),
        repo: { sourceControlAi: { enabled: true } } satisfies Pick<Repo, 'sourceControlAi'>
      })
    ).toBe(false)
  })

  it('returns true when the launch recipe matches the repo saved recipe', () => {
    expect(
      sourceControlActionRecipeMatchesTarget({
        actionId: 'fixCommitFailure',
        target: { type: 'repo', repoId: 'repo-1' },
        recipe: {
          agentId: 'claude',
          commandInputTemplate: '{basePrompt}\n\nrepo only',
          agentArgs: ''
        },
        settings: settings(),
        repo: {
          sourceControlAi: {
            enabled: true,
            actionOverrides: {
              fixCommitFailure: {
                agentId: 'claude',
                commandInputTemplate: '{basePrompt}\n\nrepo only',
                agentArgs: ''
              }
            }
          }
        } satisfies Pick<Repo, 'sourceControlAi'>
      })
    ).toBe(true)
  })

  it('returns true when the resolve conflicts recipe matches the repo saved recipe', () => {
    expect(
      sourceControlActionRecipeMatchesTarget({
        actionId: 'resolveConflicts',
        target: { type: 'repo', repoId: 'repo-1' },
        recipe: {
          agentId: 'codex',
          commandInputTemplate: '{basePrompt}',
          agentArgs: ''
        },
        settings: settings(),
        repo: {
          sourceControlAi: {
            enabled: true,
            actionOverrides: {
              resolveConflicts: {
                agentId: 'codex',
                commandInputTemplate: '{basePrompt}',
                agentArgs: ''
              }
            }
          }
        } satisfies Pick<Repo, 'sourceControlAi'>
      })
    ).toBe(true)
  })

  it('returns true when a repo recipe inherits the global command template', () => {
    const currentSettings = settings()
    currentSettings.sourceControlAi = {
      ...currentSettings.sourceControlAi!,
      actions: {
        resolveConflicts: {
          agentId: 'codex',
          commandInputTemplate: '{basePrompt}\n\ncustom global',
          agentArgs: '--model sonnet'
        }
      }
    }

    expect(
      sourceControlActionRecipeMatchesTarget({
        actionId: 'resolveConflicts',
        target: { type: 'repo', repoId: 'repo-1' },
        recipe: {
          agentId: 'codex',
          commandInputTemplate: '{basePrompt}\n\ncustom global',
          agentArgs: '--model sonnet'
        },
        settings: currentSettings,
        repo: {
          sourceControlAi: {
            enabled: true,
            actionOverrides: {
              resolveConflicts: {
                commandInputTemplate: null
              }
            }
          }
        } satisfies Pick<Repo, 'sourceControlAi'>
      })
    ).toBe(true)
  })

  it('returns true when a repo recipe explicitly clears inherited agent args', () => {
    expect(
      sourceControlActionRecipeMatchesTarget({
        actionId: 'resolveConflicts',
        target: { type: 'repo', repoId: 'repo-1' },
        recipe: {
          agentId: 'codex',
          commandInputTemplate: '{basePrompt}',
          agentArgs: ''
        },
        settings: settings(),
        repo: {
          sourceControlAi: {
            enabled: true,
            actionOverrides: {
              resolveConflicts: {
                agentArgs: null
              }
            }
          }
        } satisfies Pick<Repo, 'sourceControlAi'>
      })
    ).toBe(true)
  })
})
