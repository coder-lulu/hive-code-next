import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from './dispatcher'
import type { OrcaRuntimeService } from '../orca-runtime'
import { WORKTREE_METHODS } from './methods/worktree'
import { FOLDER_WORKSPACE_METHODS } from './methods/folder-workspace'
import { resolveRpcWorkspaceCreatorProvenance } from './workspace-creator-context'
import { normalizeWorkspaceCreatorProvenance } from '../../../shared/workspace-creator-provenance'

const sessionId = 'session-authenticated-by-relay'
const provenance = { kind: 'account-runtime', runtimeSessionId: sessionId }

function fixture() {
  const runtime = {
    getRuntimeId: () => 'runtime-1',
    dedupeWorktreeCreate: (_repo: string, _id: string, run: () => unknown) => run(),
    showRepo: vi.fn().mockResolvedValue({ id: 'repo-1', kind: 'git', path: '/project' }),
    createManagedWorktree: vi.fn().mockResolvedValue({ worktree: { id: 'workspace-1' } }),
    createFolderWorkspace: vi.fn().mockResolvedValue({ id: 'folder-1' })
  }
  return {
    runtime,
    dispatcher: new RpcDispatcher({
      runtime: runtime as unknown as OrcaRuntimeService,
      methods: [...WORKTREE_METHODS, ...FOLDER_WORKSPACE_METHODS]
    })
  }
}

describe('account workspace creator authority', () => {
  it.each(['streaming', 'unary'])(
    'preserves authenticated provenance through %s dispatch for both workspace types',
    async (mode) => {
      const { runtime, dispatcher } = fixture()
      const context = {
        authorizeRequest: vi.fn((method: string) =>
          ['worktree.create', 'folderWorkspace.create'].includes(method)
        ),
        authenticatedAccountRuntimeSessionId: sessionId,
        clientKind: 'runtime' as const,
        clientId: `account-runtime:${sessionId}`,
        connectionId: 'connection-1'
      }
      for (const [method, params] of [
        ['worktree.create', { repo: 'repo-1', name: 'feature' }],
        ['folderWorkspace.create', { projectGroupId: 'group-1', name: 'folder' }]
      ] as const) {
        const request = {
          id: method,
          authToken: '',
          method,
          params: {
            ...params,
            creatorProvenance: { kind: 'host' },
            authenticatedAccountRuntimeSessionId: 'forged'
          }
        }
        const replies: string[] = []
        if (mode === 'streaming') {
          await dispatcher.dispatchStreaming(request, (reply) => replies.push(reply), context)
          expect(JSON.parse(replies.at(-1)!)).toMatchObject({ ok: true })
        } else {
          expect(await dispatcher.dispatch(request, context)).toMatchObject({ ok: true })
        }
      }
      expect(runtime.createManagedWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ creatorProvenance: provenance })
      )
      expect(context.authorizeRequest).toHaveBeenCalledWith('worktree.create')
      expect(context.authorizeRequest).toHaveBeenCalledWith('folderWorkspace.create')
      expect(runtime.createFolderWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ creatorProvenance: provenance })
      )
      expect(normalizeWorkspaceCreatorProvenance(JSON.parse(JSON.stringify(provenance)))).toEqual(
        provenance
      )
    }
  )

  it('rejects forged caller IDs and payload provenance without authenticated session context', async () => {
    const { runtime, dispatcher } = fixture()
    const response = await dispatcher.dispatch(
      {
        id: 'forged',
        authToken: '',
        method: 'folderWorkspace.create',
        params: {
          projectGroupId: 'group-1',
          authenticatedAccountRuntimeSessionId: sessionId,
          creatorProvenance: provenance
        }
      },
      {
        clientKind: 'runtime',
        clientId: `account-runtime:${sessionId}`,
        connectionId: 'connection-1'
      }
    )
    expect(response).toMatchObject({
      ok: false,
      error: { message: 'authenticated_device_identity_missing' }
    })
    expect(runtime.createFolderWorkspace).not.toHaveBeenCalled()
    expect(() => resolveRpcWorkspaceCreatorProvenance({ clientKind: 'mobile' })).toThrow(
      'authenticated_device_identity_missing'
    )
  })

  it('keeps real paired-device and host attribution and rejects malformed stored account provenance', () => {
    expect(resolveRpcWorkspaceCreatorProvenance({ pairedDeviceId: 'device-1' })).toEqual({
      kind: 'paired-device',
      deviceId: 'device-1'
    })
    expect(resolveRpcWorkspaceCreatorProvenance({})).toEqual({ kind: 'host' })
    expect(
      normalizeWorkspaceCreatorProvenance({ kind: 'account-runtime', runtimeSessionId: ' ' })
    ).toBeUndefined()
    expect(
      normalizeWorkspaceCreatorProvenance({ kind: 'account-runtime', deviceId: sessionId })
    ).toBeUndefined()
  })
})
