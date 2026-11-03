import '../unused-default-rpc-methods.test-fixture'
import { afterEach, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import { OrcaRuntimeService } from '../../orca-runtime'
import type { RuntimeStore } from '../../runtime-store-contract'
import { REPO_METHODS } from './repo'
import { AGENT_HOOK_METHODS } from './agent-hooks'
import { CLIENT_UI_METHODS } from './client-ui'
import { WORKTREE_VISIBILITY_DEFAULTS_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import * as launchProfile from '../../../../shared/agent-launch-profile'
import * as shell from '../../../../shared/tui-agent-startup-shell'
import { createGlobalSettingsFixture } from '../../../../shared/global-settings-test-fixture'
import {
  measureSettingsWork,
  expectSettingsWorkScale
} from '../../../../shared/agent-launch-settings-work.test-helper'
import { partialRuntimeStore } from '../../runtime-store-partial-fixture'

vi.mock('../../../codex/managed-wsl-home-shell-preflight', () => ({
  prepareManagedWslCodexHomeBeforeShellLaunch: async ({
    hooksEnabled
  }: {
    hooksEnabled: boolean
  }) => (hooksEnabled ? { agent: 'codex', state: 'installed' } : null)
}))
vi.mock('../../../../shared/sidebar-inputs-switch', () => ({ ORCA_SIDEBAR_INPUTS_IS_MAIN: true }))
vi.mock('../../../claude/agent-view-service', () => ({
  getClaudeAgentViewService: () => ({ reconcile: async () => {} })
}))
afterEach(() => vi.restoreAllMocks())

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

it.each([20, 200])('projects %s repos without launch work', async (n) => {
  const settings = createGlobalSettingsFixture({
    hostSettingOverrides: { 'runtime:alpha': { displayLabel: '  Label  ' } },
    worktreeVisibilityDefaults: { external: 'show' },
    agentPermissionDefault: 'ask',
    agentDefaultArgs: { claude: '--model opus '.repeat(n) },
    agentDefaultEnv: {
      claude: Object.fromEntries(Array.from({ length: n }, (_, i) => [`K${i}`, 'private']))
    }
  })
  const composed = vi.spyOn(launchProfile, 'projectAgentLaunchProfile')
  const tokenized = vi.spyOn(shell, 'tokenizeStartupCommand')
  const store: Pick<RuntimeStore, 'getSettings' | 'updateSettings' | 'runDurableMutation'> = {
    getSettings: () => settings,
    updateSettings: (updates) => Object.assign(settings, updates),
    runDurableMutation: async (mutate) => mutate().value
  }
  const host = new OrcaRuntimeService(partialRuntimeStore(store))
  vi.spyOn(host, 'configureNotificationDismissalStore').mockImplementation(() => {})
  vi.spyOn(host.pairedServerRows!, 'attach').mockReturnValue(() => {})
  expect(host.pairedServerRows?.['options'].hostLabelOverrides().get('runtime:alpha')).toBe('Label')
  vi.spyOn(host, 'enrichMissingRepoGitRemoteIdentities').mockResolvedValue(undefined)
  vi.spyOn(host, 'listVisibleRepos').mockReturnValue(
    Array.from({ length: n }, (_, i) => ({
      id: `repo-${i}`,
      path: '/repo',
      displayName: `Repo ${i}`,
      badgeColor: 'gray',
      addedAt: 0,
      externalWorktreeVisibilityLegacy: false
    }))
  )
  const dispatcher = new RpcDispatcher({
    runtime: host,
    methods: [...REPO_METHODS, ...CLIENT_UI_METHODS, ...AGENT_HOOK_METHODS]
  })
  const legacyReplies: string[] = []
  const currentReplies: string[] = []

  await dispatcher.dispatchStreaming(makeRequest('repo.list'), (reply) => legacyReplies.push(reply))
  await dispatcher.dispatchStreaming(
    makeRequest('repo.list'),
    (reply) => currentReplies.push(reply),
    { clientCapabilities: [WORKTREE_VISIBILITY_DEFAULTS_RUNTIME_CAPABILITY] }
  )

  expect(JSON.parse(legacyReplies[0]!).result.repos).toHaveLength(n)
  expect(JSON.parse(legacyReplies[0]!).result.repos[0].externalWorktreeVisibility).toBe('show')
  delete settings.worktreeVisibilityDefaults
  legacyReplies.length = 0
  await dispatcher.dispatchStreaming(makeRequest('repo.list'), (reply) => legacyReplies.push(reply))
  expect(
    JSON.parse(legacyReplies[0]!).result.repos.map(
      (repo: { externalWorktreeVisibility: string }) => repo.externalWorktreeVisibility
    )
  ).toEqual(Array(n).fill('hide'))
  settings.agentStatusHooksEnabled = true
  settings.disabledTuiAgents = []
  expect(
    await dispatcher.dispatch(
      makeRequest('agentHooks.prepareCodexForWslPane', {
        codexHome: '/home/qa/codex',
        orcaCodexHome: '/home/qa/codex',
        wslDistro: 'Ubuntu'
      })
    )
  ).toMatchObject({ ok: true, result: { state: 'installed' } })
  expect(composed).not.toHaveBeenCalled()
  expect(tokenized).not.toHaveBeenCalled()
  const originalArgs = settings.agentDefaultArgs?.claude
  if (originalArgs === undefined) {
    throw new Error('Missing Claude Arguments fixture')
  }
  const published = settings
  for (const [row, params] of Object.entries({
    'settings.get': undefined,
    'settings.update': { machineName: 'Host' },
    'settings.updatePRBotAuthorOverride': { author: 'test', isBot: true },
    'settings.getAgentLaunch': undefined,
    'settings.mutateAgentLaunch': { type: 'permissions', agent: 'claude', mode: 'ask' },
    'settings.update raw-text': {
      agentDefaultArgs: {
        ...published.agentDefaultArgs,
        claude: `--permission-mode auto ${originalArgs}`
      },
      agentDefaultEnv: { ...published.agentDefaultEnv, goose: { KEEP: 'new' } }
    }
  })) {
    const [method, ingress] = row.split(' ')
    composed.mockClear()
    tokenized.mockClear()
    const { value, work } = measureSettingsWork(() =>
      dispatcher.dispatch(makeRequest(method, params))
    )
    const response = await value
    const currentArgs = settings.agentDefaultArgs?.claude
    if (currentArgs === undefined) {
      throw new Error('Missing Claude Arguments after dispatch')
    }
    expect(response.ok).toBe(true)
    const text = JSON.stringify(response)
    expect(text).toContain(ingress ? '--permission-mode auto' : '--model opus')
    expect(composed).not.toHaveBeenCalled()
    expect(tokenized).not.toHaveBeenCalled()
    const bytes = text.length + work.bytes
    const visits = work.entries + work.visits
    const comparisons = work.comparisons
    expect(work.entries).toBeLessThanOrEqual(40 * n + 8000)
    expect(comparisons).toBeLessThanOrEqual(4 * (n + 1) * Math.ceil(Math.log2(n + 1)))
    expectSettingsWorkScale(`response-${method}-${!!ingress}`, n, [visits, bytes])
    const namesOnly = method.includes('AgentLaunch')
    const env = settings.agentDefaultEnv
    if (!env?.claude) {
      throw new Error('Missing Claude Environment after dispatch')
    }
    const result = JSON.parse(text).result.settings
    expect(result[namesOnly ? 'environmentNames' : 'agentDefaultEnv'].claude).toEqual(
      namesOnly ? Object.keys(env.claude).sort() : env.claude
    )
    expect(text.includes('private')).toBe(!namesOnly)
    if (ingress) {
      expect(settings.agentPermissionOverrides?.claude).toBe('ask')
      expect(settings.agentPermissionDefault).toBe('ask')
      expect(env.goose).toEqual({ KEEP: 'new' })
    }
  }
  expect(JSON.parse(currentReplies[0]!).result.repos[0].externalWorktreeVisibility).toBeUndefined()
})
