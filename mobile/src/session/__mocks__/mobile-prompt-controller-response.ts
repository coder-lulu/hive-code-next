import type { RpcResponse } from '../../transport/types'

export function response(
  accepted = true,
  outcome: 'accepted' | 'refused' | 'unverifiable' | 'legacy' = accepted ? 'accepted' : 'refused'
): RpcResponse {
  return {
    id: 'send',
    ok: true,
    result: {
      send: { accepted, ...(outcome === 'legacy' ? {} : { writeSettlement: { outcome } }) }
    },
    _meta: { runtimeId: 'r' }
  }
}
