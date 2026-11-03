import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { claudeAndCodexDeclared } from './structured-agent-session-adapter-router-test-support'
import {
  structuredAgentSessionImmediatePermission,
  structuredAgentSessionLaunchPermission
} from './structured-agent-session-launch-permission'
import type { AgentChatPermissionChoice } from '../../../shared/agent-chat-permission-mode'

const deps = { agents: claudeAndCodexDeclared() }
function record(
  provider: string,
  permissionMode?: AgentChatPermissionChoice
): Pick<AgentSessionRecord, 'sessionId' | 'provider' | 'options' | 'permissionMode'> {
  return { sessionId: 'session-1', provider, permissionMode }
}

describe('current saved launch permission owner', () => {
  it.each(['own', 'ask', 'accept-edits', 'auto', 'full-access'] as const)(
    'preserves the saved Claude %s choice at both admission boundaries',
    async (mode) => {
      const saved = record('claude', mode)
      expect(structuredAgentSessionImmediatePermission(deps, saved)).toBe(mode)
      await expect(structuredAgentSessionLaunchPermission(deps, saved)).resolves.toBe(mode)
    }
  )
  it('defaults legacy records to Ask and refuses unknown providers', async () => {
    await expect(structuredAgentSessionLaunchPermission(deps, record('claude'))).resolves.toBe(
      'ask'
    )
    await expect(
      structuredAgentSessionLaunchPermission(deps, record('unknown'))
    ).resolves.toBeNull()
    expect(structuredAgentSessionImmediatePermission(deps, record('unknown'))).toBeNull()
  })
  it('preserves Codex Own without substituting a provider permission policy', async () => {
    await expect(
      structuredAgentSessionLaunchPermission(deps, record('codex', 'own'))
    ).resolves.toBe('own')
  })
})
