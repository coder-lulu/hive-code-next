import { AGENT_SESSION_COMMANDS_ON_REQUEST_CAPABILITY } from '../../../../shared/structured-agent-session-surface-capabilities'
import { describe, expect, it } from 'vitest'
import {
  PI_STRUCTURED_DIALOGS_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import {
  clientRequestsCommands,
  createSupportFollowsHostSetting,
  isStructuredNativeChatEnabled,
  structuredAgentsReadBy,
  clientRendersStructuredAgent,
  supportsStructuredAgentSessions
} from './structured-agent-session-policy'

const CAPABLE = [STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY]

describe('Pi audience in a registered-agents client', () => {
  const registered = [...CAPABLE, STRUCTURED_AGENT_SESSION_REGISTERED_AGENTS_RUNTIME_CAPABILITY]

  it('keeps Pi out of tab and restart audiences until the dialog shape is advertised', () => {
    expect(clientRendersStructuredAgent(registered, 'pi')).toBe(false)
    expect(clientRendersStructuredAgent(registered, 'grok')).toBe(true)
    const audience = structuredAgentsReadBy(
      { clientKind: 'runtime', clientCapabilities: registered },
      ['codex', 'grok', 'pi']
    )
    expect(audience?.('pi')).toBe(false)
    expect(audience?.('grok')).toBe(true)
    expect(
      structuredAgentsReadBy(
        {
          clientKind: 'runtime',
          clientCapabilities: [...registered, PI_STRUCTURED_DIALOGS_RUNTIME_CAPABILITY]
        },
        ['codex', 'grok', 'pi']
      )
    ).toBeUndefined()
  })
})

describe('supportsStructuredAgentSessions', () => {
  it.each(['runtime', 'mobile'] as const)(
    'admits a %s client that advertises the capability',
    (clientKind) => {
      expect(supportsStructuredAgentSessions({ clientKind, clientCapabilities: CAPABLE })).toBe(
        true
      )
    }
  )

  it('admits a capability-less in-process caller, which negotiates nothing', () => {
    expect(
      supportsStructuredAgentSessions({ clientKind: undefined, clientCapabilities: undefined })
    ).toBe(true)
  })

  it.each(['runtime', 'mobile'] as const)(
    'refuses a %s client that did not advertise the capability',
    (clientKind) => {
      expect(supportsStructuredAgentSessions({ clientKind, clientCapabilities: [] })).toBe(false)
      expect(supportsStructuredAgentSessions({ clientKind, clientCapabilities: undefined })).toBe(
        false
      )
    }
  )
})

describe('createSupportFollowsHostSetting', () => {
  it.each(['runtime', 'mobile'] as const)(
    'leaves a %s client that picks its own launch mode to capability alone',
    (clientKind) => {
      expect(
        createSupportFollowsHostSetting({
          clientKind,
          clientCapabilities: [...CAPABLE, STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY]
        })
      ).toBe(false)
    }
  )

  it.each(['runtime', 'mobile'] as const)(
    'answers a %s client that leaves the mode to the host with the host setting',
    (clientKind) => {
      expect(createSupportFollowsHostSetting({ clientKind, clientCapabilities: CAPABLE })).toBe(
        true
      )
    }
  )

  it('leaves an in-process caller, the same build as the host, to capability alone', () => {
    expect(
      createSupportFollowsHostSetting({ clientKind: undefined, clientCapabilities: undefined })
    ).toBe(false)
  })
})

describe('host provider preference', () => {
  const runtime = (settings: unknown) =>
    ({
      getClientSettings: () => settings
    }) as Parameters<typeof isStructuredNativeChatEnabled>[0]

  it('uses the actual known agent and refuses an unknown agent', () => {
    const host = runtime({ nativeChatProviders: { codex: false } })
    expect(isStructuredNativeChatEnabled(host, 'codex')).toBe(false)
    expect(isStructuredNativeChatEnabled(host, 'claude')).toBe(true)
    expect(isStructuredNativeChatEnabled(host, 'unknown')).toBe(false)
  })

  it('does not treat inherited provider values as stored preferences', () => {
    const host = runtime({ nativeChatProviders: Object.create({ codex: false }) })
    expect(isStructuredNativeChatEnabled(host, 'codex')).toBe(true)
  })

  it('refuses when the settings reader throws', () => {
    const host = {
      getClientSettings: () => {
        throw new Error('unavailable')
      }
    }
    expect(isStructuredNativeChatEnabled(host, 'codex')).toBe(false)
  })
})

it('requests commands only for the negotiated commands capability', () => {
  expect(clientRequestsCommands({})).toBe(false)
  expect(clientRequestsCommands({ clientCapabilities: CAPABLE })).toBe(false)
  expect(
    clientRequestsCommands({ clientCapabilities: [AGENT_SESSION_COMMANDS_ON_REQUEST_CAPABILITY] })
  ).toBe(true)
})
