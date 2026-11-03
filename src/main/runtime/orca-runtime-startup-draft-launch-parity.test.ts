import './orca-runtime-test-lifecycle.spec'
import { describe, expect, it, vi } from 'vitest'
import {
  OrcaRuntimeService,
  computeWorktreePathMock,
  detectInstalledAgentsWithShellPathHydrationMock,
  ensurePathWithinWorkspaceMock,
  listWorktrees
} from './orca-runtime-test-mocks.spec'
import type { WorktreeMeta } from './orca-runtime-test-mocks.spec'
import { makeWorktreeMeta, store } from './orca-runtime-test-fixtures.spec'
import { createWorktreeWithStartupAgent } from '../agent-launch/startup-agent-worktree-create'
import type { RuntimeManagedWorktreeCreateArgs } from './runtime-managed-worktree-create-types'
import type { HostWorktreeTarget } from '../../shared/worktree/host-qualified-identity'
import type { TuiAgent } from '../../shared/tui-agent'
import type { AgentPermissionChoice } from '../../shared/tui-agent-permission-choice'
import { WorktreeCreate } from '../../shared/rpc-contract/worktree-create-params'
import { buildManagedWorktreeCreateArgs } from './rpc/methods/worktree-create-args'

type DraftSettings = {
  defaultTuiAgent: TuiAgent | null
  agentDefaultArgs: Record<string, string>
  agentDefaultEnv?: Partial<Record<TuiAgent, Record<string, string>>>
  agentPermissionDefault?: AgentPermissionChoice
  agentCmdOverrides?: Partial<Record<TuiAgent, string>>
  detected: string[]
}

type SpawnCapture = { command?: string; env?: Record<string, string>; launchToken?: string }

async function runCreate(
  route: 'create' | 'launch',
  settings: DraftSettings,
  request: Omit<RuntimeManagedWorktreeCreateArgs, 'repoSelector' | 'name'>,
  capture?: SpawnCapture[]
) {
  detectInstalledAgentsWithShellPathHydrationMock.mockReset()
  detectInstalledAgentsWithShellPathHydrationMock.mockResolvedValue(settings.detected)
  const metaById: Record<string, WorktreeMeta> = {}
  const runtime = new OrcaRuntimeService({
    ...store,
    getSettings: () => ({
      ...store.getSettings(),
      defaultTuiAgent: settings.defaultTuiAgent,
      agentCmdOverrides: settings.agentCmdOverrides ?? {},
      agentDefaultArgs: settings.agentDefaultArgs,
      ...(settings.agentDefaultEnv ? { agentDefaultEnv: settings.agentDefaultEnv } : {}),
      ...(settings.agentPermissionDefault
        ? { agentPermissionDefault: settings.agentPermissionDefault }
        : {})
    }),
    getAllWorktreeMeta: () => metaById,
    getWorktreeMeta: (worktreeId: string) => metaById[worktreeId],
    setWorktreeMeta: ({ id }: HostWorktreeTarget, meta: Partial<WorktreeMeta>) => {
      metaById[id] = { ...(metaById[id] ?? makeWorktreeMeta()), ...meta }
      return metaById[id]
    }
  })
  const spawn = vi.fn(async (options: SpawnCapture) => {
    capture?.push(options)
    return { id: `pty-${route}` }
  })
  runtime.setPtyController({
    spawn,
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null
  })
  const path = `/tmp/workspaces/draft-parity-${route}`
  computeWorktreePathMock.mockReturnValue(path)
  ensurePathWithinWorkspaceMock.mockReturnValue(path)
  vi.mocked(listWorktrees).mockResolvedValue([
    { path, head: 'abc', branch: 'draft-parity', isBare: false, isMainWorktree: false }
  ])
  const args = { repoSelector: 'id:repo-1', name: 'draft-parity', ...request }
  const result =
    route === 'create'
      ? await runtime.createManagedWorktree(args)
      : await createWorktreeWithStartupAgent(runtime, args)
  return {
    createdWithAgent: metaById[result.worktree.id]?.createdWithAgent,
    spawned: spawn.mock.calls.map(([options]) => options.command ?? null),
    detections: detectInstalledAgentsWithShellPathHydrationMock.mock.calls.length
  }
}

const DRAFT = 'https://github.com/stablyai/orca/issues/123'

describe('worktree semantic startup through the execution host', () => {
  it.each([
    ['agent', '--yolo'],
    ['agent', '--approval-mode yolo'],
    ['draft', '--yolo'],
    ['draft', '--approval-mode yolo']
  ] as const)('enforces Gemini manual permission for %s with %s', async (kind, flags) => {
    const capture: SpawnCapture[] = []
    const args = buildManagedWorktreeCreateArgs(
      WorktreeCreate.parse({
        repo: 'id:repo-1',
        name: 'gemini-manual',
        startupPermissionMode: 'manual',
        ...(kind === 'agent' ? { startupAgent: 'gemini' } : { startupDraft: DRAFT })
      }),
      {}
    )
    await runCreate(
      'create',
      {
        defaultTuiAgent: 'gemini',
        agentDefaultArgs: { gemini: `${flags} --debug` },
        detected: []
      },
      args,
      capture
    )
    expect(capture).toHaveLength(1)
    expect(capture[0]?.command).toContain('--approval-mode')
    expect(capture[0]?.command).toContain('default')
    expect(capture[0]?.command).toContain('--debug')
    expect(capture[0]?.command).not.toContain('yolo')
  })

  it.each(['agent', 'draft'] as const)(
    'clears Goose bypass env for %s after account routing',
    async (kind) => {
      const capture: SpawnCapture[] = []
      const args = buildManagedWorktreeCreateArgs(
        WorktreeCreate.parse({
          repo: 'id:repo-1',
          name: 'goose-manual',
          startupPermissionMode: 'manual',
          ...(kind === 'agent' ? { startupAgent: 'goose' } : { startupDraft: DRAFT })
        }),
        {}
      )
      await runCreate(
        'create',
        {
          defaultTuiAgent: 'goose',
          agentDefaultArgs: {},
          detected: [],
          agentDefaultEnv: { goose: { GOOSE_MODE: 'auto', KEEP_HOST_ENV: 'yes' } }
        },
        { ...args, startupAccountEnv: { GOOSE_MODE: 'auto', ACCOUNT_HOME: 'trusted' } },
        capture
      )
      expect(capture).toHaveLength(1)
      expect(capture[0]?.env).toMatchObject({ KEEP_HOST_ENV: 'yes', ACCOUNT_HOME: 'trusted' })
      expect(capture[0]?.env).not.toHaveProperty('GOOSE_MODE')
      expect(capture[0]?.command).toContain('GOOSE_MODE')
    }
  )

  it('rejects a conflicting draft command override instead of creating without startup', async () => {
    const capture: SpawnCapture[] = []
    const args = buildManagedWorktreeCreateArgs(
      WorktreeCreate.parse({
        repo: 'id:repo-1',
        name: 'draft-conflict',
        startupDraft: DRAFT,
        startupPermissionMode: 'manual'
      }),
      {}
    )
    await expect(
      runCreate(
        'create',
        {
          defaultTuiAgent: 'claude',
          agentDefaultArgs: {},
          detected: [],
          agentCmdOverrides: { claude: 'claude --dangerously-skip-permissions' }
        },
        args,
        capture
      )
    ).rejects.toThrow('Could not build launch command')
    expect(capture).toEqual([])
  })
  it.each([
    ['agent', 'manual', 'default'],
    ['agent', 'yolo', 'bypass'],
    ['agent', 'auto', 'auto'],
    ['draft', 'manual', 'default'],
    ['draft', 'yolo', 'bypass'],
    ['draft', 'auto', 'auto']
  ] as const)(
    'applies %s %s intent to the actual spawn and caller token',
    async (kind, mode, expected) => {
      const capture: SpawnCapture[] = []
      const args = buildManagedWorktreeCreateArgs(
        WorktreeCreate.parse({
          repo: 'id:repo-1',
          name: 'host-owned',
          ...(kind === 'agent' ? { startupAgent: 'claude' } : { startupDraft: DRAFT }),
          startupCommand: 'untrusted-client-command',
          startupEnv: { UNSAFE_CLIENT_ENV: 'discard' },
          startupPermissionMode: mode,
          startupLaunchPreferences: { model: 'opus', effort: 'high', mode: 'full-access' },
          startupLaunchToken: 'worktree-client-token'
        }),
        {}
      )
      await runCreate(
        'create',
        {
          defaultTuiAgent: 'claude',
          agentDefaultArgs: { claude: '--dangerously-skip-permissions --verbose' },
          agentDefaultEnv: { claude: { KEEP_HOST_ENV: 'yes', ACCOUNT_HOME: 'stale' } },
          agentPermissionDefault: mode === 'yolo' ? 'ask' : 'full-access',
          detected: []
        },
        { ...args, startupAccountEnv: { ACCOUNT_HOME: 'trusted' } },
        capture
      )

      expect(capture).toHaveLength(1)
      const spawned = capture[0]!
      expect(spawned.command).toContain('claude')
      expect(spawned.command).toContain('--verbose')
      expect(spawned.command).toContain('opus')
      if (expected === 'bypass') {
        expect(spawned.command).toContain('--dangerously-skip-permissions')
      } else {
        expect(spawned.command).toContain('--permission-mode')
        expect(spawned.command).toContain(expected)
        expect(spawned.command).not.toContain('--dangerously-skip-permissions')
      }
      expect(spawned.command).not.toContain('untrusted-client-command')
      expect(spawned.launchToken).toBe('worktree-client-token')
      expect(spawned.env).toMatchObject({
        KEEP_HOST_ENV: 'yes',
        ACCOUNT_HOME: 'trusted',
        ORCA_AGENT_LAUNCH_TOKEN: 'worktree-client-token'
      })
      expect(spawned.env).not.toHaveProperty('UNSAFE_CLIENT_ENV')
    }
  )

  it('preserves a semantic agent token without an explicit permission', async () => {
    const capture: SpawnCapture[] = []
    const args = buildManagedWorktreeCreateArgs(
      WorktreeCreate.parse({
        repo: 'id:repo-1',
        name: 'token-agent',
        startupAgent: 'claude',
        startupLaunchToken: 'agent-without-mode'
      }),
      {}
    )
    await runCreate(
      'create',
      {
        defaultTuiAgent: 'claude',
        agentDefaultArgs: {},
        detected: []
      },
      args,
      capture
    )
    expect(capture[0]).toMatchObject({
      launchToken: 'agent-without-mode',
      env: { ORCA_AGENT_LAUNCH_TOKEN: 'agent-without-mode' }
    })
  })

  it('applies preferences, trusted env and the token to a draft-paste fallback', async () => {
    const capture: SpawnCapture[] = []
    const args = buildManagedWorktreeCreateArgs(
      WorktreeCreate.parse({
        repo: 'id:repo-1',
        name: 'paste-draft',
        startupDraft: DRAFT,
        startupPermissionMode: 'manual',
        startupLaunchToken: 'paste-draft-token',
        startupLaunchPreferences: { mode: 'full-access' }
      }),
      {}
    )
    await runCreate(
      'create',
      {
        defaultTuiAgent: 'claude-agent-teams',
        agentDefaultArgs: { 'claude-agent-teams': '--dangerously-skip-permissions' },
        detected: []
      },
      { ...args, startupAccountEnv: { ACCOUNT_HOME: 'trusted' } },
      capture
    )
    expect(capture).toHaveLength(1)
    expect(capture[0]?.command).toContain('default')
    expect(capture[0]?.command).not.toContain('--dangerously-skip-permissions')
    expect(capture[0]).toMatchObject({
      launchToken: 'paste-draft-token',
      env: { ORCA_AGENT_LAUNCH_TOKEN: 'paste-draft-token', ACCOUNT_HOME: 'trusted' }
    })
  })

  it('refuses auto for an unsupported host-selected draft agent before spawning', async () => {
    const capture: SpawnCapture[] = []
    const args = buildManagedWorktreeCreateArgs(
      WorktreeCreate.parse({
        repo: 'id:repo-1',
        name: 'unsupported',
        startupDraft: DRAFT,
        startupPermissionMode: 'auto'
      }),
      {}
    )
    await expect(
      runCreate(
        'create',
        {
          defaultTuiAgent: 'gemini',
          agentDefaultArgs: {},
          detected: []
        },
        args,
        capture
      )
    ).rejects.toThrow('Automatic approval is unavailable')
    expect(capture).toEqual([])
  })
})

// Linked-draft launch execution must preserve direct-create results.
describe('a linked-draft create through the launch executor', () => {
  it.each([false, true])(
    'matches the create when the default agent cannot be launched (activate %s)',
    async (activate) => {
      const settings = {
        defaultTuiAgent: 'claude' as const,
        agentDefaultArgs: { claude: '--foo "unbalanced' },
        detected: []
      }
      const request = { startupDraft: DRAFT, activate }

      const before = await runCreate('create', settings, request)
      const after = await runCreate('launch', settings, request)

      expect(after).toEqual(before)
      expect(before.createdWithAgent).toBeUndefined()
      if (!activate) {
        expect(before.spawned).toHaveLength(1)
      }
    }
  )

  it('detects once and starts the detected agent with the draft, as the create does', async () => {
    const settings = { defaultTuiAgent: null, agentDefaultArgs: {}, detected: ['claude'] }
    const request = { startupDraft: DRAFT, activate: false }

    const before = await runCreate('create', settings, request)
    const after = await runCreate('launch', settings, request)

    expect(after).toEqual(before)
    expect(before.detections).toBe(1)
    expect(before.createdWithAgent).toBe('claude')
    expect(before.spawned).toEqual([expect.stringContaining(DRAFT)])
  })

  it('detects once when no agent is found, and records none', async () => {
    const settings = { defaultTuiAgent: null, agentDefaultArgs: {}, detected: [] }
    const request = { startupDraft: DRAFT, activate: false }

    const before = await runCreate('create', settings, request)
    const after = await runCreate('launch', settings, request)

    expect(after).toEqual(before)
    expect(before.detections).toBe(1)
    expect(before.createdWithAgent).toBeUndefined()
  })

  it('keeps a requested agent the request named, without detecting', async () => {
    const settings = { defaultTuiAgent: null, agentDefaultArgs: {}, detected: ['codex'] }
    const request = { startupDraft: DRAFT, createdWithAgent: 'claude' as const, activate: false }

    const before = await runCreate('create', settings, request)
    const after = await runCreate('launch', settings, request)

    expect(after).toEqual(before)
    expect(before.detections).toBe(0)
    expect(before.createdWithAgent).toBe('claude')
  })
})
