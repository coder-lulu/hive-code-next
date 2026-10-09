import { describe, expect, it } from 'vitest'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../../shared/agent-session-record.test-fixture'
import { lookupOrcaAgentSession } from './structured-session-mail-address'
import { managedPiProviderHandle } from '../../../shared/agent-session-provider-handle-encoding'

describe('structured session address lookup', () => {
  it('recognizes the managed-Pi native session identity without reading a Codex thread id', () => {
    const record = agentSessionRecordFixture(
      agentSessionLeaseFixture({ sessionId: 'pi-owner', runtimeKind: 'native' })
    )
    record.provider = 'managed-pi'
    record.accountHome = { variable: 'PI_CODING_AGENT_DIR', path: '/verified/pi-home' }
    record.providerHandleChain = [
      {
        linkId: 'pi-link',
        handle: managedPiProviderHandle('pi-native'),
        origin: 'created',
        mintedAtFence: 1,
        observedAt: 1
      }
    ]
    const store = {
      getRecord: (id: string) => (id === record.sessionId ? record : null),
      listRecords: () => [record]
    }
    expect(lookupOrcaAgentSession(store, 'pi-native')).toEqual({
      kind: 'provider-id',
      orcaSessionId: 'pi-owner'
    })
    expect(lookupOrcaAgentSession(store, 'pi-owner')).toEqual({ kind: 'found', record })
    expect(lookupOrcaAgentSession(store, 'unowned')).toEqual({ kind: 'unknown' })
  })
})
