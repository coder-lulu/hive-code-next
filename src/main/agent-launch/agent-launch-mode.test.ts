import { describe, expect, it, vi } from 'vitest'
import {
  decideAgentLaunchMode,
  downgradeAgentLaunchModeForHost,
  readAgentLaunchModeSettings,
  resolveAgentLaunchModeOnHost
} from './agent-launch-mode'

const decide = (settings: Parameters<typeof decideAgentLaunchMode>[0]['settings']) =>
  decideAgentLaunchMode({ placement: { agent: 'claude' }, settings })

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: deliberately exercise the settings boundary with untrusted values; this method is the only runtime member read.
const runtime = (settings: unknown) =>
  ({ getClientSettings: vi.fn(() => settings) }) as unknown as Parameters<
    typeof readAgentLaunchModeSettings
  >[0]

describe('current launch settings and execution authority', () => {
  it('defers new-workspace support until creation and then requires the host answer', async () => {
    const host = {
      getStructuredAgentSessionCreateSupport: vi.fn(async () => {
        throw new Error('unavailable')
      })
    }
    const candidate = decide({})
    expect(await resolveAgentLaunchModeOnHost(host, candidate, undefined, 'claude')).toBe(candidate)
    expect(host.getStructuredAgentSessionCreateSupport).not.toHaveBeenCalled()
    expect(
      await resolveAgentLaunchModeOnHost(host, candidate, 'created-worktree', 'claude')
    ).toMatchObject({ mode: 'terminal', reason: 'structured_support_unknown' })
    expect(host.getStructuredAgentSessionCreateSupport).toHaveBeenCalledWith(
      'id:created-worktree',
      'claude',
      { requireInstalledChatProgram: true }
    )
  })
  it('defaults known empty settings to structured and honors only the selected agent false', () => {
    expect(decide({}).mode).toBe('structured')
    expect(decide({ nativeChatProviders: { claude: false } })).toMatchObject({
      mode: 'terminal',
      preferred: 'terminal'
    })
    expect(decide({ nativeChatProviders: { codex: false } }).mode).toBe('structured')
  })

  it.each([null, undefined])(
    'does not convert unknown settings %s into structured success',
    (settings) => {
      expect(decide(settings)).toMatchObject({
        mode: 'terminal',
        reason: 'structured_support_unknown'
      })
    }
  )

  it('uses only own typed provider choices from the runtime', () => {
    const providers = Object.assign(Object.create({ claude: false }), { codex: false, pi: 'false' })
    expect(readAgentLaunchModeSettings(runtime({ nativeChatProviders: providers }))).toEqual({
      nativeChatProviders: { codex: false }
    })
    expect(
      readAgentLaunchModeSettings(
        runtime(Object.create({ nativeChatProviders: { claude: false } }))
      )
    ).toEqual({ nativeChatProviders: {} })
  })

  it.each([false, true])(
    'applies the explicit caller preference %s without consulting another settings owner',
    (preference) => {
      const host = runtime({ nativeChatProviders: { claude: !preference } })
      const settings = readAgentLaunchModeSettings(host, preference)
      expect(host.getClientSettings).not.toHaveBeenCalled()
      expect(decide(settings).mode).toBe(preference ? 'structured' : 'terminal')
      expect(settings).not.toHaveProperty('experimentalNativeChat')
    }
  )

  it('keeps a missing host settings answer unavailable', () => {
    const host = {
      getClientSettings: () => {
        throw new Error('disconnected')
      }
    }
    expect(decide(readAgentLaunchModeSettings(host))).toMatchObject({
      mode: 'terminal',
      reason: 'structured_support_unknown'
    })
  })

  it('does not infer a view preference from instruction, command or permission arguments', () => {
    const settings = readAgentLaunchModeSettings(
      runtime({
        nativeChatProviders: {},
        agentCmdOverrides: { claude: 'custom-wrapper' },
        agentDefaultArgs: { claude: ['--permission-mode', 'bypassPermissions'] },
        agentSystemInstruction: 'Use the terminal command when needed.'
      })
    )
    expect(decide(settings)).toMatchObject({ mode: 'structured', reason: 'user_default' })
  })

  it('rejects an untyped caller preference and malformed host settings', () => {
    const host = runtime({})
    expect(Reflect.apply(readAgentLaunchModeSettings, undefined, [host, 'false'])).toBeNull()
    expect(host.getClientSettings).not.toHaveBeenCalled()
    expect(readAgentLaunchModeSettings(runtime('unavailable'))).toBeNull()
    expect(readAgentLaunchModeSettings(runtime([]))).toBeNull()
  })

  it('requires remote placement, client rendering and executing host support independently', async () => {
    expect(
      decideAgentLaunchMode({ placement: { agent: 'claude', on: 'remote' }, settings: {} })
    ).toMatchObject({ mode: 'terminal', reason: 'remote_execution_host' })
    expect(
      decideAgentLaunchMode({
        placement: { agent: 'claude', callerRendersStructured: false },
        settings: {}
      })
    ).toMatchObject({ mode: 'terminal', reason: 'structured_sessions_unavailable' })
    const host = {
      getStructuredAgentSessionCreateSupport: async () => {
        throw new Error('disconnected')
      }
    }
    expect(await resolveAgentLaunchModeOnHost(host, decide({}), 'wt', 'claude')).toMatchObject({
      mode: 'terminal',
      reason: 'structured_support_unknown'
    })
  })
})

describe('explicit surface settlement', () => {
  it('respects explicit terminal selection independently of native preference', () => {
    expect(
      decideAgentLaunchMode({ placement: { agent: 'claude' }, settings: {}, surface: 'terminal' })
    ).toMatchObject({ mode: 'terminal', reason: 'requested' })
  })
  it('allows explicit chat over a known terminal preference', () => {
    expect(
      decideAgentLaunchMode({
        placement: { agent: 'claude' },
        settings: { nativeChatProviders: { claude: false } },
        surface: 'chat'
      })
    ).toMatchObject({ mode: 'structured', reason: 'requested' })
  })
  it('refuses unsupported explicit chat before workspace effects', () => {
    expect(() =>
      decideAgentLaunchMode({
        placement: { agent: 'claude', on: 'remote' },
        settings: {},
        surface: 'chat'
      })
    ).toThrow()
  })
  it('preserves a created workspace with terminal fallback after host refusal', () => {
    const receipt = decideAgentLaunchMode({
      placement: { agent: 'claude' },
      settings: {},
      surface: 'chat'
    })
    expect(() =>
      downgradeAgentLaunchModeForHost(
        receipt,
        { supported: false, reason: 'chat-program' },
        undefined,
        { phase: 'before-effects', agent: 'claude' }
      )
    ).toThrow()
    expect(
      downgradeAgentLaunchModeForHost(
        receipt,
        { supported: false, reason: 'chat-program' },
        undefined,
        { phase: 'created-workspace', agent: 'claude' }
      )
    ).toMatchObject({ mode: 'terminal', reason: 'chat_runtime_not_installed' })
  })
})
