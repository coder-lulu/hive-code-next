import { describe, expect, it } from 'vitest'
import {
  agentSessionProviderHandleKey,
  agentSessionProviderHandleRoot
} from './agent-session-provider-handle'
import {
  decodePersistedAgentSessionProviderHandle,
  encodePersistedAgentSessionProviderHandle,
  isAgentSessionProviderHandle,
  managedPiProviderHandle,
  agentSessionWireProviderHandle
} from './agent-session-provider-handle-encoding'

const SESSION = 'ha-session:12345678-1234-4567-8123-123456789abc'

describe('managed Pi opaque handle integration', () => {
  it('keeps the persisted managed identity and decodes it into the current handle model', () => {
    const handle = managedPiProviderHandle(SESSION)
    const stored = { provider: 'managed-pi', sessionId: SESSION }
    expect(isAgentSessionProviderHandle(handle)).toBe(true)
    expect(encodePersistedAgentSessionProviderHandle(handle)).toEqual(stored)
    expect(decodePersistedAgentSessionProviderHandle(stored)).toEqual(handle)
    expect(agentSessionProviderHandleKey(handle)).toBe(`managed-pi:${JSON.stringify(SESSION)}`)
    expect(agentSessionProviderHandleRoot(handle)).toBe(`managed-pi:${JSON.stringify(SESSION)}`)
    expect(agentSessionWireProviderHandle(handle)).toBeNull()
  })

  it('rejects invalid, mixed or resumable managed identities without aliasing another provider', () => {
    expect(isAgentSessionProviderHandle(managedPiProviderHandle('thread-1'))).toBe(false)
    expect(
      isAgentSessionProviderHandle({ ...managedPiProviderHandle(SESSION), resumeCursor: 'x' })
    ).toBe(false)
    expect(
      decodePersistedAgentSessionProviderHandle({
        provider: 'managed-pi',
        sessionId: SESSION,
        extra: true
      })
    ).toBeNull()
    expect(
      decodePersistedAgentSessionProviderHandle({
        provider: 'managed-pi',
        sessionId: SESSION,
        nativeId: SESSION
      })
    ).toBeNull()
  })
})
