import {
  closeTestStores,
  testState,
  createStore,
  dataFile,
  writeDataFile,
  readDataFile,
  makeRepo
} from './persistence/persistence-test-harness'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PersistedState } from '../shared/persisted-state-types'
import { DEFAULT_SIDEBAR_WIDTH } from '../shared/constants'
import { setSourceControlActionDefault } from '../shared/source-control-ai-actions'
import { resolveSourceControlActionRecipe } from '../shared/source-control-ai'

// Stub the ~/.ssh/config parser so the SSH-import test drives the real Store with deterministic hosts, not the operator's actual ~/.ssh/config.
const { loadUserSshConfigMock, sshConfigHostsToTargetsMock } = vi.hoisted(() => ({
  loadUserSshConfigMock: vi.fn(),
  sshConfigHostsToTargetsMock: vi.fn()
}))

vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: loadUserSshConfigMock,
  sshConfigHostsToTargets: sshConfigHostsToTargetsMock
}))
const { trackMock, getCohortAtEmitMock } = vi.hoisted(() => ({
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => {
      const decoded = ciphertext.toString('utf-8')
      if (!decoded.startsWith('encrypted:')) {
        throw new Error('invalid ciphertext')
      }
      return decoded.slice('encrypted:'.length)
    }
  }
}))

vi.mock('./telemetry/client', () => ({
  track: trackMock
}))

vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

describe('Store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
    trackMock.mockReset()
    getCohortAtEmitMock.mockReset()
    getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })
  // Invalid profile state must not silently replace user settings with defaults.

  it('refuses invalid legacy JSON without replacing it with defaults', () => {
    mkdirSync(testState.dir, { recursive: true })
    writeFileSync(dataFile(), '{{{invalid json', 'utf-8')

    expect(() => createStore()).toThrow('Profile state JSON is invalid')
    expect(readFileSync(dataFile(), 'utf8')).toBe('{{{invalid json')
  })

  // ── 4. Schema migration: merges with defaults ───────────────────────

  it('merges loaded data with defaults for missing fields', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [makeRepo()],
      worktreeMeta: {},
      settings: { theme: 'dark' },
      githubCache: { pr: {}, issue: {} }
      // ui and workspaceSession intentionally omitted
    })

    const store = await createStore()
    // ui should have defaults
    const ui = store.getUI()
    expect(ui.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(ui.rightSidebarOpen).toBe(true)
    expect(ui.rightSidebarTab).toBe('explorer')
    // settings should preserve the overridden value
    expect(store.getSettings().theme).toBe('dark')
    // new fields get defaults when missing from persisted data
    expect(store.getSettings().editorAutoSave).toBe(false)
    expect(store.getSettings().editorAutoSaveDelayMs).toBe(1000)
    expect(store.getSettings().refreshLocalBaseRefOnWorktreeCreate).toBe(false)
    expect(store.getSettings().rightSidebarOpenByDefault).toBe(true)
    expect(store.getSettings().sourceControlViewMode).toBe('list')
    expect(store.getSettings().showGitIgnoredFiles).toBe(true)
    expect(store.getSettings().showTasksButton).toBe(true)
    expect(store.getSettings().showAutomationsButton).toBe(true)
    expect(store.getSettings().combinedDiffFileTreeVisibleByDefault).toBe(false)
    expect(store.getSettings().visibleTaskProviders).toEqual(['github', 'gitlab', 'linear', 'jira'])
    expect(Object.hasOwn(store.getSettings(), 'experimentalActivity')).toBe(false)
    expect(Object.hasOwn(store.getSettings(), 'experimentalActivityDefaultedOffForAllUsers')).toBe(
      false
    )
    expect(store.getSettings().experimentalTerminalAttention).toBe(false)
    expect(store.getSettings().sourceControlAi?.enabled).toBe(true)
    expect(store.getSettings().notifications.customSoundPath).toBeNull()
    // repos should be loaded
    expect(store.getRepos()).toHaveLength(1)
  })

  it('loads current source-control settings with host-isolated models and instructions', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        sourceControlAi: {
          enabled: true,
          agentId: 'cursor',
          selectedModelByAgent: { cursor: 'gpt-5.2' },
          selectedModelByAgentByHost: { 'ssh:conn-1': { cursor: 'remote-model' } },
          discoveredModelsByAgent: {
            cursor: [{ id: 'gpt-5.2', label: 'GPT 5.2' }]
          },
          discoveredModelsByAgentByHost: {
            'ssh:conn-1': {
              cursor: [{ id: 'remote-model', label: 'Remote Model' }]
            }
          },
          selectedThinkingByModel: { 'gpt-5.2': 'high' },
          instructionsByOperation: {
            commitMessage: 'Use Conventional Commits.',
            branchName: 'Use Conventional Commits.'
          },
          customAgentCommand: 'cursor-agent'
        }
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    const sourceControlAi = store.getSettings().sourceControlAi

    expect(sourceControlAi).toMatchObject({
      enabled: true,
      agentId: 'cursor',
      selectedModelByAgent: { cursor: 'gpt-5.2' },
      selectedThinkingByModel: { 'gpt-5.2': 'high' },
      customAgentCommand: 'cursor-agent',
      instructionsByOperation: {
        commitMessage: 'Use Conventional Commits.',
        pullRequest: '',
        branchName: 'Use Conventional Commits.'
      }
    })
    expect(sourceControlAi?.selectedModelByAgentByHost?.['ssh:conn-1']?.cursor).toBe('remote-model')
    expect(sourceControlAi?.discoveredModelsByAgent?.cursor?.[0]?.id).toBe('gpt-5.2')
    expect(sourceControlAi?.discoveredModelsByAgentByHost?.['ssh:conn-1']?.cursor?.[0]?.id).toBe(
      'remote-model'
    )
    expect(Object.hasOwn(store.getSettings(), 'commitMessageAi')).toBe(false)
    store.flush()
    const reopened = await createStore()
    expect(reopened.getSettings().sourceControlAi).toEqual(sourceControlAi)
  })

  it('preserves an explicit branch auto-rename opt-out without an age marker', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { autoRenameBranchFromWork: false },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings().autoRenameBranchFromWork).toBe(false)
    expect(Object.hasOwn(store.getSettings(), 'autoRenameBranchFromWorkDefaultedOn')).toBe(false)
  })

  it('drops a retired auto-rename age marker while preserving the user opt-out', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        autoRenameBranchFromWork: false,
        autoRenameBranchFromWorkDefaultedOn: true
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings().autoRenameBranchFromWork).toBe(false)
    expect(Object.hasOwn(store.getSettings(), 'autoRenameBranchFromWorkDefaultedOn')).toBe(false)
  })

  it('loads and persists explicit current TUI scroll sensitivity', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalTuiScrollSensitivity: 3 },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings().terminalTuiScrollSensitivity).toBe(3)
    expect(Object.hasOwn(store.getSettings(), 'terminalTuiScrollSensitivityDefaultedToOne')).toBe(
      false
    )
    store.flush()
    expect((readDataFile() as PersistedState).settings.terminalTuiScrollSensitivity).toBe(3)
  })

  it('drops retired scroll sensitivity markers while preserving the current value', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        terminalTuiScrollSensitivity: 3,
        terminalTuiScrollSensitivityDefaultedToOne: true
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings().terminalTuiScrollSensitivity).toBe(3)
    expect(Object.hasOwn(store.getSettings(), 'terminalTuiScrollSensitivityDefaultedToOne')).toBe(
      false
    )
  })

  it('persists current scroll sensitivity updates without migration markers', async () => {
    const store = await createStore()

    const updated = store.updateSettings({
      terminalTuiScrollSensitivity: 3
    })

    expect(updated.terminalTuiScrollSensitivity).toBe(3)
    expect(Object.hasOwn(updated, 'terminalTuiScrollSensitivityDefaultedToOne')).toBe(false)
  })

  it('ignores retired rollback fields while preserving current disabled settings and custom recipes through reload', async () => {
    const sourceControlAi = {
      enabled: false,
      agentId: 'custom',
      selectedModelByAgent: { codex: 'current-model' },
      selectedThinkingByModel: { 'current-model': 'high' },
      customAgentCommand: 'current-writer {prompt}',
      instructionsByOperation: {
        commitMessage: 'Current instructions',
        pullRequest: 'Preserve PR instructions'
      },
      actions: {
        commitMessage: {
          agentId: 'custom',
          commandInputTemplate: 'custom {basePrompt}',
          agentArgs: '--literal-flag'
        }
      },
      prCreationDefaults: { draft: true, openAfterCreate: true },
      launchActionDefaults: { fixChecks: { agentId: 'claude' } }
    }
    writeDataFile({
      settings: {
        sourceControlAi,
        commitMessageAi: { enabled: true, agentId: 'claude', customPrompt: 'Retired prompt' }
      }
    })
    const store = await createStore()
    const current = store.getSettings().sourceControlAi!
    expect(current).toMatchObject({
      enabled: false,
      agentId: 'custom',
      selectedModelByAgent: sourceControlAi.selectedModelByAgent,
      selectedThinkingByModel: sourceControlAi.selectedThinkingByModel,
      customAgentCommand: sourceControlAi.customAgentCommand,
      instructionsByOperation: sourceControlAi.instructionsByOperation,
      actions: sourceControlAi.actions,
      prCreationDefaults: sourceControlAi.prCreationDefaults
    })
    expect(Object.hasOwn(current, 'launchActionDefaults')).toBe(false)
    expect(Object.hasOwn(store.getSettings(), 'commitMessageAi')).toBe(false)
    store.flush()
    const reopened = await createStore()
    expect(reopened.getSettings().sourceControlAi).toEqual(current)
    expect(Object.hasOwn(reopened.getSettings(), 'commitMessageAi')).toBe(false)
  })

  it('ignores retired projection input without clobbering current action templates', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        sourceControlAi: {
          enabled: true,
          agentId: 'codex',
          selectedModelByAgent: {},
          selectedModelByAgentByHost: {},
          discoveredModelsByAgent: {},
          discoveredModelsByAgentByHost: {},
          selectedThinkingByModel: {},
          customAgentCommand: '',
          instructionsByOperation: {
            commitMessage: '',
            pullRequest: '',
            branchName: ''
          },
          actions: {
            commitMessage: {
              agentId: 'codex',
              commandInputTemplate: 'use $best-commit-msg to write a commit'
            },
            branchName: {
              agentId: 'claude',
              commandInputTemplate: 'name this branch from {firstPrompt}'
            }
          },
          prCreationDefaults: {}
        },
        commitMessageAi: {
          enabled: true,
          agentId: 'codex',
          selectedModelByAgent: {},
          selectedModelByAgentByHost: {},
          discoveredModelsByAgent: {},
          discoveredModelsByAgentByHost: {},
          selectedThinkingByModel: {},
          customPrompt: 'use $best-commit-msg to write a commit',
          customAgentCommand: ''
        }
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()

    expect(store.getSettings().sourceControlAi?.actions?.commitMessage).toEqual({
      agentId: 'codex',
      commandInputTemplate: 'use $best-commit-msg to write a commit'
    })
    expect(store.getSettings().sourceControlAi?.actions?.branchName).toEqual({
      agentId: 'claude',
      commandInputTemplate: 'name this branch from {firstPrompt}'
    })
  })

  it('keeps a cleared global commit-message recipe template after persistence re-read', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        sourceControlAi: {
          enabled: true,
          agentId: 'codex',
          selectedModelByAgent: {},
          selectedModelByAgentByHost: {},
          discoveredModelsByAgent: {},
          discoveredModelsByAgentByHost: {},
          selectedThinkingByModel: {},
          instructionsByOperation: { commitMessage: '모든 커밋 메시지는 한국어로 작성한다' },
          customAgentCommand: ''
        }
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    const current = store.getSettings().sourceControlAi!
    store.updateSettings({
      sourceControlAi: {
        ...current,
        actions: setSourceControlActionDefault(current.actions, 'commitMessage', {
          commandInputTemplate: '{basePrompt}'
        })
      }
    })
    store.flush()

    const reopened = await createStore()
    expect(reopened.getSettings().sourceControlAi?.actions?.commitMessage).toMatchObject({
      commandInputTemplate: '{basePrompt}'
    })
    expect(reopened.getSettings().sourceControlAi?.instructionsByOperation.commitMessage).toBe('')
    expect(Object.hasOwn(reopened.getSettings(), 'commitMessageAi')).toBe(false)
  }, 10_000)

  it('keeps a repository recipe reset inherited across global edits and reload without resetting other recipes', async () => {
    writeDataFile({ settings: {}, repos: [makeRepo()] })
    const store = await createStore()
    const unrelated = {
      agentId: 'claude' as const,
      commandInputTemplate: 'fix {basePrompt}',
      agentArgs: '--verbose'
    }
    store.updateRepo(
      { id: 'r1', executionHostId: 'local' },
      {
        sourceControlAi: {
          actionOverrides: {
            commitMessage: { agentId: 'codex', commandInputTemplate: 'repo {basePrompt}' },
            fixChecks: unrelated
          }
        }
      }
    )
    store.updateRepo(
      { id: 'r1', executionHostId: 'local' },
      { sourceControlAi: { actionOverrides: { fixChecks: unrelated } } }
    )
    const current = store.getSettings().sourceControlAi!
    store.updateSettings({
      sourceControlAi: {
        ...current,
        actions: setSourceControlActionDefault(current.actions, 'commitMessage', {
          agentId: 'custom',
          commandInputTemplate: 'global {basePrompt}',
          agentArgs: '--literal'
        }),
        customAgentCommand: 'writer {prompt}'
      }
    })
    store.flush()
    const reopened = await createStore()
    const repo = reopened.getRepos()[0]!
    expect(Object.hasOwn(repo.sourceControlAi?.actionOverrides ?? {}, 'commitMessage')).toBe(false)
    expect(repo.sourceControlAi?.actionOverrides?.fixChecks).toEqual(unrelated)
    expect(
      resolveSourceControlActionRecipe({
        actionId: 'commitMessage',
        settings: reopened.getSettings(),
        repo
      })
    ).toMatchObject({
      agentId: 'custom',
      commandInputTemplate: 'global {basePrompt}',
      agentArgs: '--literal'
    })
  })

  it('normalizes malformed visible task providers on load', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { visibleTaskProviders: ['gitlab', 'unknown', 'gitlab'] },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().visibleTaskProviders).toEqual(['gitlab'])
  })

  it('preserves a deliberate Jira provider opt-out without an age marker', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        visibleTaskProviders: ['gitlab']
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().visibleTaskProviders).toEqual(['gitlab'])
  })

  it('normalizes malformed terminal shortcut policy on load', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { terminalShortcutPolicy: 'terminal-maybe' },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().terminalShortcutPolicy).toBe('orca-first')
  })

  it('normalizes malformed source control group order on load', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { sourceControlGroupOrder: 'tracked-first' },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().sourceControlGroupOrder).toBe('changes-first')
  })

  it('repairs drifted task provider defaults on load', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { visibleTaskProviders: ['linear'], defaultTaskSource: 'github' },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().defaultTaskSource).toBe('github')
    expect(store.getSettings().visibleTaskProviders).toEqual(['github', 'linear'])
  })

  it('normalizes invalid task provider defaults on load', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { visibleTaskProviders: ['gitlab'], defaultTaskSource: 'bitbucket' as never },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().defaultTaskSource).toBe('gitlab')
    expect(store.getSettings().visibleTaskProviders).toEqual(['gitlab'])
  })

  it('normalizes persisted open-in applications on load', async () => {
    writeDataFile({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: {
        openInApplications: [
          { id: 'cursor', label: ' Cursor ', command: ' cursor ' },
          { id: 'cursor', label: 'Dup', command: 'dup' },
          { id: '', label: 'Zed', command: 'zed' },
          { id: 'bad', label: ' ', command: 'bad' }
        ]
      },
      ui: {},
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    })

    const store = await createStore()
    expect(store.getSettings().openInApplications).toEqual([
      { id: 'cursor', label: 'Cursor', command: 'cursor' },
      { id: 'open-in-3', label: 'Zed', command: 'zed' }
    ])
  })
})
