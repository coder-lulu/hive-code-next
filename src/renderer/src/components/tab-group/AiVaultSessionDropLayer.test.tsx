// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AiVaultSessionDropLayer from './AiVaultSessionDropLayer'
import {
  AI_VAULT_SESSION_DRAG_TYPE,
  clearAiVaultSessionDragData,
  type AiVaultSessionDragPayload
} from '@/lib/ai-vault-session-drag'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  launch: vi.fn(),
  prepare: vi.fn(),
  error: vi.fn(),
  success: vi.fn()
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'linux' }))
vi.mock('@/lib/launch-ai-vault-session', () => ({ launchAiVaultSessionInNewTab: mocks.launch }))
vi.mock('@/lib/activate-ai-vault-structured-session', () => ({
  activateAiVaultStructuredSession: vi.fn()
}))
vi.mock('@/lib/ai-vault-resume-command', () => ({
  buildAiVaultDropRepinStartup: vi.fn(),
  getAiVaultAgentProviderSession: vi.fn(() => ({ provider: 'codex', sessionId: 'session-1' }))
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }))

const worktreeId = 'repo-remote::/srv/project'
const payload: AiVaultSessionDragPayload = {
  agent: 'codex',
  sessionId: 'session-1',
  title: 'Remote session',
  command: 'codex resume session-1',
  sessionFilePath: '/srv/sessions/session-1.jsonl',
  sessionExecutionHostId: 'runtime:owner-a',
  sessionCwd: '/srv/project',
  env: { EXAMPLE: 'remote' },
  envToDelete: ['OLD_TOKEN'],
  launchConfig: {
    agentArgs: '--model example',
    agentEnv: { EXAMPLE: 'remote' },
    agentPermissionMode: 'manual'
  }
}
const originalApi = window.api

function drop(value: unknown = { ...payload, kind: 'ai-vault-session', version: 1 }): void {
  render(
    <>
      <div data-tab-group-body-id="target-group" data-worktree-id={worktreeId} />
      <AiVaultSessionDropLayer worktreeId={worktreeId} enabled />
    </>
  )
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    dataTransfer: {
      value: { types: [AI_VAULT_SESSION_DRAG_TYPE], getData: () => JSON.stringify(value) }
    },
    clientX: { value: 300 },
    clientY: { value: 200 }
  })
  fireEvent(window, event)
  expect(event.defaultPrevented).toBe(true)
}

beforeEach(() => {
  vi.clearAllMocks()
  clearAiVaultSessionDragData()
  mocks.state = {
    activeRepoId: 'other-local-repo',
    activeWorktreeId: 'other-local-worktree',
    projects: [],
    projectGroups: [],
    folderWorkspaces: [],
    settings: {},
    repos: [{ id: 'repo-remote', path: '/srv/project', executionHostId: 'runtime:owner-a' }],
    worktreesByRepo: {
      'repo-remote': [
        { id: worktreeId, repoId: 'repo-remote', path: '/srv/project', hostId: 'runtime:owner-a' }
      ]
    }
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 600, 400)
  )
  window.api = {
    ...originalApi,
    aiVault: { ...originalApi?.aiVault, prepareSessionResume: mocks.prepare }
  }
  mocks.prepare.mockResolvedValue({ useRealCodexHome: false })
  mocks.launch.mockReturnValue({
    tabId: 'new-tab',
    runtimeLaunch: Promise.resolve({ status: 'launched' })
  })
})
afterEach(() => {
  cleanup()
  clearAiVaultSessionDragData()
  vi.restoreAllMocks()
  window.api = originalApi
})

describe('AiVaultSessionDropLayer actual window drop', () => {
  it('preserves the dropped workspace, host preparation, pane and startup instead of the active workspace', async () => {
    drop()
    await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1))
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({
      agent: 'codex',
      sessionId: 'session-1',
      filePath: payload.sessionFilePath,
      executionHostId: 'runtime:owner-a',
      codexHome: null
    })
    expect(mocks.launch).toHaveBeenCalledExactlyOnceWith({
      agent: 'codex',
      worktreeId,
      command: payload.command,
      cwd: payload.sessionCwd,
      env: payload.env,
      envToDelete: payload.envToDelete,
      launchConfig: payload.launchConfig,
      providerSession: { provider: 'codex', sessionId: 'session-1' },
      targetGroupId: 'target-group',
      splitDirection: undefined
    })
    expect(mocks.error).not.toHaveBeenCalled()
  })
  it.each(['different-host', 'unknown-workspace', 'invalid-payload'])(
    'rejects %s before preparing or launching',
    async (kind) => {
      if (kind === 'unknown-workspace') {
        mocks.state.repos = []
        mocks.state.worktreesByRepo = {}
      }
      drop(
        kind === 'invalid-payload'
          ? { kind: 'ai-vault-session', version: 1 }
          : {
              ...payload,
              kind: 'ai-vault-session',
              version: 1,
              ...(kind === 'different-host' ? { sessionExecutionHostId: 'runtime:owner-b' } : {})
            }
      )
      await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
      expect(mocks.prepare).not.toHaveBeenCalled()
      expect(mocks.launch).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()
    }
  )
  it.each(['missing-session', 'invalid-host-response'])(
    'does not launch or claim success for %s',
    async (kind) => {
      if (kind === 'missing-session') {
        mocks.prepare.mockRejectedValueOnce(new Error('Session no longer exists'))
      } else {
        mocks.prepare.mockResolvedValueOnce({})
      }
      drop()
      await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
      expect(mocks.prepare).toHaveBeenCalledTimes(1)
      expect(mocks.launch).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()
    }
  )
  it('waits for the runtime outcome and reports a failed launch without a queued success', async () => {
    let finish!: (value: { status: string; message: string }) => void
    mocks.launch.mockReturnValueOnce({
      tabId: null,
      runtimeLaunch: new Promise((resolve) => {
        finish = resolve
      })
    })
    drop()
    await waitFor(() => expect(mocks.launch).toHaveBeenCalledTimes(1))
    expect(mocks.success).not.toHaveBeenCalled()
    finish({ status: 'failed', message: 'Runtime unavailable' })
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1))
    expect(mocks.success).not.toHaveBeenCalled()
  })
})
