/**
 * The shared half of the launch route: the renderer's `resolveAgentLaunchRoute` and orchestration's
 * worker-mode decision both answer from these, so a change here moves both surfaces at once.
 */

import { describe, expect, it } from 'vitest'
import {
  STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY,
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from './protocol-version'
import {
  isNativeChatDefaultFor,
  normalizeNativeChatProviders,
  resolveStructuredNativeChatSupport,
  type StructuredNativeChatSupportInput
} from './structured-native-chat-launch-route'

function support(overrides: Partial<StructuredNativeChatSupportInput> = {}) {
  return resolveStructuredNativeChatSupport({
    agent: 'claude',
    executionHostId: 'local',
    hostCapabilities: [
      STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
      STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY
    ],
    hostStructuredAgents: ['claude', 'codex'],
    workspaceKind: 'git-worktree',
    ...overrides
  })
}

describe('current per-agent chat preference', () => {
  it('honors explicit false only for the selected provider', () => {
    const settings = { nativeChatProviders: { claude: false } }
    expect(isNativeChatDefaultFor(settings, 'claude')).toBe(false)
    expect(isNativeChatDefaultFor(settings, 'codex')).toBe(true)
    expect(isNativeChatDefaultFor({ nativeChatProviders: { claude: true } }, 'claude')).toBe(true)
  })

  it.each([null, undefined, {}])(
    'uses the enabled default for %s without granting host support',
    (settings) => {
      expect(isNativeChatDefaultFor(settings, 'claude')).toBe(true)
      expect(support({ hostCapabilities: null, hostStructuredAgents: undefined })).toEqual({
        supported: false,
        blocker: 'runtime-capability-unknown'
      })
    }
  )

  it('normalizes only own known-provider boolean choices', () => {
    const input = Object.assign(Object.create({ claude: false }), {
      codex: false,
      pi: true,
      grok: 'false',
      unknown: false
    })
    expect(normalizeNativeChatProviders(input)).toEqual({ codex: false, pi: true })
  })
})

describe('per-launch structured feasibility', () => {
  it.each(['claude', 'codex'] as const)('supports a local %s launch', (agent) => {
    expect(support({ agent })).toEqual({ supported: true })
  })

  const blockerCases: [string, Partial<StructuredNativeChatSupportInput>, string][] = [
    ['a reused PTY agent', { reusesTerminal: true }, 'reused-terminal'],
    ['grok', { agent: 'grok' }, 'agent-without-structured-session'],
    ['openclaude', { agent: 'openclaude' }, 'agent-without-structured-session'],
    ['a custom start directory', { startsOutsideWorkspaceRoot: true }, 'custom-start-directory'],
    ['an SSH host', { executionHostId: 'ssh:host-a' }, 'remote-execution-host'],
    ['a missing capability', { hostCapabilities: [] }, 'runtime-capability'],
    ['an unanswered host', { hostCapabilities: null }, 'runtime-capability-unknown']
  ]

  it.each(blockerCases)('names %s as the blocker', (_name, overrides, blocker) => {
    expect(support(overrides)).toEqual({ supported: false, blocker })
  })

  it('blocks a WSL or repair-required project runtime', () => {
    expect(
      support({
        projectRuntime: {
          status: 'resolved',
          runtime: {
            kind: 'wsl',
            hostPlatform: 'wsl',
            projectId: 'repo-1',
            distro: 'Ubuntu',
            reason: 'project-override',
            cacheKey: 'wsl'
          }
        }
      })
    ).toEqual({ supported: false, blocker: 'project-runtime' })
    expect(
      support({
        projectRuntime: {
          status: 'repair-required',
          repair: {
            projectId: 'repo-1',
            preferredRuntime: { kind: 'wsl', distro: null },
            reason: 'wsl-distro-required',
            source: 'project-override',
            cacheKey: 'repair'
          }
        }
      })
    ).toEqual({ supported: false, blocker: 'project-runtime' })
  })

  // Why floating is supported: its configured directory resolves like any other workspace, so a
  // session can be filed under it. Workspace kind no longer refuses anything on its own.
  it.each(['folder', 'floating', 'git-worktree'] as const)(
    'supports a local %s workspace',
    (workspaceKind) => {
      expect(support({ workspaceKind })).toEqual({ supported: true })
    }
  )
})

describe('agents beyond Claude and Codex', () => {
  const REGISTERED = [
    STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
    STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY
  ]

  it.each(['grok', 'pi'] as const)(
    '%s is offered only by a host that advertises and lists it',
    (agent) => {
      expect(
        support({ agent, hostCapabilities: REGISTERED, hostStructuredAgents: [agent] })
      ).toEqual({ supported: true })
    }
  )

  it('are not offered by a host that does not advertise its registered agents', () => {
    expect(
      support({
        agent: 'grok',
        hostCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY],
        hostStructuredAgents: ['grok']
      })
    ).toEqual({
      supported: false,
      blocker: 'runtime-capability'
    })
  })

  it('are not offered when the host did not list them', () => {
    expect(support({ agent: 'grok', hostCapabilities: REGISTERED })).toEqual({
      supported: false,
      blocker: 'agent-without-structured-session'
    })
    expect(
      support({ agent: 'grok', hostCapabilities: REGISTERED, hostStructuredAgents: ['claude'] })
    ).toEqual({ supported: false, blocker: 'agent-without-structured-session' })
  })

  it.each(['claude', 'codex', 'grok'] as const)(
    'requires actual inventory evidence for %s too',
    (agent) => {
      expect(support({ agent, hostStructuredAgents: undefined })).toEqual({
        supported: false,
        blocker: 'runtime-capability-unknown'
      })
      expect(support({ agent, hostStructuredAgents: [] })).toEqual({
        supported: false,
        blocker: 'agent-without-structured-session'
      })
      expect(
        support({
          agent,
          hostStructuredAgents: [agent],
          hostCapabilities: [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]
        })
      ).toEqual({ supported: false, blocker: 'runtime-capability' })
    }
  )

  it('requires the paired host and client launch contract independently of provider preference', () => {
    const hostCapabilities = [...REGISTERED, STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY]
    const input = { executionHostId: 'runtime:paired-host', hostCapabilities }
    expect(support(input)).toEqual({ supported: false, blocker: 'client-capability' })
    expect(support({ ...input, clientCapabilities: hostCapabilities })).toEqual({ supported: true })
    expect(
      support({ ...input, hostCapabilities: REGISTERED, clientCapabilities: hostCapabilities })
    ).toEqual({ supported: false, blocker: 'runtime-capability' })
  })
})
