import { describe, expect, it } from 'vitest'
import { getDefaultSourceControlAiSettings } from '../source-control-ai'
import { GitGenerateCommitMessage, SourceControlAiSettings } from './git-params'

describe('current Git generation settings contract', () => {
  it('accepts the actual current recipe settings', () => {
    expect(
      GitGenerateCommitMessage.safeParse({
        worktree: 'repo::worktree',
        sourceControlAi: getDefaultSourceControlAiSettings()
      }).success
    ).toBe(true)
  })
  it('refuses a retired mirrored override rather than executing with a different default', () => {
    expect(
      GitGenerateCommitMessage.safeParse({
        worktree: 'repo::worktree',
        commitMessageAi: {
          enabled: false,
          agentId: 'codex',
          selectedModelByAgent: {},
          selectedThinkingByModel: {},
          customPrompt: '',
          customAgentCommand: ''
        }
      }).success
    ).toBe(false)
  })
  it('refuses retired launch-default input inside the current settings shape', () => {
    expect(
      SourceControlAiSettings.safeParse({
        ...getDefaultSourceControlAiSettings(),
        launchActionDefaults: { commitMessage: { commandInputTemplate: 'retired' } }
      }).success
    ).toBe(false)
  })
})
