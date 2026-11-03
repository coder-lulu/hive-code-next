import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateRuntimeCommitMessage,
  generateRuntimePullRequestFields,
  discoverRuntimeCommitMessageModels,
  cancelRuntimeGenerateCommitMessage,
  cancelRuntimeGeneratePullRequestFields
} from './runtime-git-generation-client'

const gitGenerateCommitMessage = vi.fn()
const gitGeneratePullRequestFields = vi.fn()
const gitDiscoverCommitMessageModels = vi.fn()
const gitCancelGenerateCommitMessage = vi.fn()
const gitCancelGeneratePullRequestFields = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()
const runtimeCall = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', {
    api: {
      git: {
        generateCommitMessage: gitGenerateCommitMessage,
        generatePullRequestFields: gitGeneratePullRequestFields,
        discoverCommitMessageModels: gitDiscoverCommitMessageModels,
        cancelGenerateCommitMessage: gitCancelGenerateCommitMessage,
        cancelGeneratePullRequestFields: gitCancelGeneratePullRequestFields
      },
      runtime: { call: runtimeCall },
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall }
    }
  })
})

describe('Source Control AI remote ownership', () => {
  it.each([undefined, null, '', '  '])(
    'refuses remote generation, discovery and cancellation without a worktree id (%j)',
    async (worktreeId) => {
      const context = {
        target: { kind: 'environment' as const, environmentId: 'env-1' },
        worktreeId,
        worktreePath: '/repo'
      }
      const unavailable = {
        success: false,
        error: 'Remote Source Control AI requires a worktree id.'
      }
      await expect(generateRuntimeCommitMessage(context)).resolves.toEqual(unavailable)
      await expect(
        generateRuntimePullRequestFields(context, {
          base: 'main',
          title: '',
          body: '',
          draft: false
        })
      ).resolves.toEqual(unavailable)
      await expect(discoverRuntimeCommitMessageModels(context, 'codex')).resolves.toEqual(
        unavailable
      )
      await expect(cancelRuntimeGenerateCommitMessage(context)).rejects.toThrow(unavailable.error)
      await expect(cancelRuntimeGeneratePullRequestFields(context)).rejects.toThrow(
        unavailable.error
      )
      expect(gitGenerateCommitMessage).not.toHaveBeenCalled()
      expect(gitGeneratePullRequestFields).not.toHaveBeenCalled()
      expect(gitDiscoverCommitMessageModels).not.toHaveBeenCalled()
      expect(gitCancelGenerateCommitMessage).not.toHaveBeenCalled()
      expect(gitCancelGeneratePullRequestFields).not.toHaveBeenCalled()
      expect(runtimeEnvironmentTransportCall).not.toHaveBeenCalled()
      expect(runtimeCall).not.toHaveBeenCalled()
    }
  )
})
