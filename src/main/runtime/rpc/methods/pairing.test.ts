import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { PAIRING_METHODS } from './pairing'

describe('retired relay pairing RPC boundary', () => {
  it.each(['pairing.provisionRelay', 'pairing.getEndpoints', 'pairing.delegatedMobileDevice.sync'])(
    'does not register %s or accept injected authority',
    async (method) => {
      const runtime = { getRuntimeId: () => 'test-runtime' }
      const dispatcher = new RpcDispatcher({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Unknown-method admission reads only runtime identity.
        runtime: runtime as OrcaRuntimeService,
        methods: PAIRING_METHODS
      })
      const response = await new Promise((resolve) => {
        void dispatcher.dispatchStreaming(
          {
            id: 'request-1',
            authToken: '',
            method,
            params: {
              reqId: 'install-1',
              authorization: { mode: 'relay-basis', basisConnId: 'attacker' }
            }
          },
          (frame) => resolve(JSON.parse(frame))
        )
      })
      expect(response).toMatchObject({ ok: false, error: { code: 'method_not_found' } })
    }
  )
})
