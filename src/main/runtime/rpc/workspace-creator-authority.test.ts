import { describe, expect, it } from 'vitest'
import { resolveRpcWorkspaceCreatorProvenance } from './workspace-creator-context'
import { WorkspaceRowSchema } from '../../../shared/sidebar-list/workspace-rows'

describe('workspace creator provenance boundary', () => {
  it('does not treat a claimed account client ID as authenticated provenance', () => {
    expect(() =>
      resolveRpcWorkspaceCreatorProvenance({
        clientId: 'account-runtime:claimed',
        clientKind: 'runtime',
        connectionId: 'connection'
      })
    ).toThrow('authenticated_device_identity_missing')
  })
  it('preserves the server-authenticated account session through the catalog schema', () => {
    const provenance = resolveRpcWorkspaceCreatorProvenance({
      authenticatedAccountRuntimeSessionId: 'authenticated-session',
      clientId: 'account-runtime:claimed',
      clientKind: 'runtime',
      connectionId: 'connection'
    })
    expect(WorkspaceRowSchema.shape.creatorProvenance.parse(provenance)).toEqual({
      kind: 'account-runtime',
      runtimeSessionId: 'authenticated-session'
    })
  })
  it('rejects empty account session identifiers in catalog rows', () => {
    expect(
      WorkspaceRowSchema.shape.creatorProvenance.safeParse({
        kind: 'account-runtime',
        runtimeSessionId: '  '
      }).success
    ).toBe(false)
  })
})
