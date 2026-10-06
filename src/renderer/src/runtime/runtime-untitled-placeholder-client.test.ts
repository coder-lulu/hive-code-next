import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRuntimeUntitledPlaceholder,
  discardRuntimeUntitledPlaceholder,
  releaseRuntimeUntitledPlaceholder
} from './runtime-untitled-placeholder-client'
import {
  installRuntimeFileClientEnvironment,
  runtimeEnvironmentCall,
  runtimeEnvironmentTransportCall,
  fsCreateFile,
  fsCreateDir,
  fsReadFile,
  fsWriteFile,
  fsDeletePath,
  fsRename,
  type PreloadStub
} from './runtime-file-client-test-harness'
import {
  FILE_MUTATION_OWNERSHIP_UPDATE_REQUIRED_MESSAGE,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../shared/protocol-version'

const localCreate: PreloadStub = vi.fn()
const localDiscard: PreloadStub = vi.fn()
const localRelease: PreloadStub = vi.fn()
const path = '/remote/repo/untitled.md'
const token = 'actual-host-issued-opaque-token'
const context = {
  settings: { activeRuntimeEnvironmentId: 'env-1' },
  worktreeId: 'wt-1',
  worktreePath: '/remote/repo',
  expectedExecutionHostId: 'ssh:build-host' as const,
  expectedSshTargetId: 'build-host',
  expectedSshConnectionGeneration: 19
}
const localContext = {
  ...context,
  settings: { activeRuntimeEnvironmentId: null },
  connectionId: 'build-host'
}
const params = {
  worktree: 'id:wt-1',
  relativePath: 'untitled.md',
  expectedExecutionHostId: 'ssh:build-host',
  expectedSshTargetId: 'build-host',
  expectedSshConnectionGeneration: 19
}
const recovery = {
  id: 'retained-capture-id',
  originalPath: path,
  retainedPath: '/remote/private/payload',
  manifestPath: '/remote/private/manifest.jsonl',
  restoredToOriginalPath: false
}

function reply(result: unknown): object {
  return { id: 'placeholder-rpc', ok: true, result, _meta: { runtimeId: 'remote-runtime' } }
}
function noLocal(): void {
  for (const port of [
    localCreate,
    localDiscard,
    localRelease,
    fsCreateFile,
    fsCreateDir,
    fsReadFile,
    fsWriteFile,
    fsDeletePath,
    fsRename
  ]) {
    expect(port).not.toHaveBeenCalled()
  }
}
function methods(): string[] {
  return runtimeEnvironmentCall.mock.calls.map(([request]) => request.method)
}

installRuntimeFileClientEnvironment()
beforeEach(() => {
  localCreate.mockReset()
  localDiscard.mockReset()
  localRelease.mockReset()
  Object.assign(window.api.fs, {
    createUntitledPlaceholder: localCreate,
    discardUntitledPlaceholder: localDiscard,
    releaseUntitledPlaceholder: localRelease
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('untitled placeholder client wire and owning-host boundaries', () => {
  it.each([token, null])(
    'accepts current runtime creation result %s after real admission',
    async (result) => {
      runtimeEnvironmentCall.mockResolvedValue(reply(result))
      expect(await createRuntimeUntitledPlaceholder(context, path)).toBe(result)
      expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
        selector: 'env-1',
        method: 'files.createUntitledPlaceholder',
        params,
        timeoutMs: 15_000
      })
      expect(runtimeEnvironmentTransportCall).toHaveBeenCalledWith({
        selector: 'env-1',
        method: 'status.get',
        timeoutMs: 15_000
      })
      expect(methods()).toEqual(['files.createUntitledPlaceholder'])
      noLocal()
    }
  )

  it('permits ordinary remote creation only for an actual method_not_found RPC refusal', async () => {
    runtimeEnvironmentCall
      .mockResolvedValueOnce({
        id: 'missing',
        ok: false,
        error: { code: 'method_not_found', message: 'Method unavailable' }
      })
      .mockResolvedValueOnce(reply({ ok: true }))
    expect(await createRuntimeUntitledPlaceholder(context, path)).toBeNull()
    expect(methods()).toEqual(['files.createUntitledPlaceholder', 'files.createFile'])
    expect(runtimeEnvironmentCall).toHaveBeenLastCalledWith({
      selector: 'env-1',
      method: 'files.createFile',
      params,
      timeoutMs: 15_000
    })
    noLocal()
  })

  it.each(['EACCES', 'forbidden', 'unknown', 'method_not_found_suffix'])(
    'refuses runtime error %s without ordinary or local downgrade',
    async (code) => {
      runtimeEnvironmentCall.mockResolvedValue({
        id: 'refused',
        ok: false,
        error: { code, message: 'Owning host refused creation' }
      })
      await expect(createRuntimeUntitledPlaceholder(context, path)).rejects.toMatchObject({ code })
      expect(methods()).toEqual(['files.createUntitledPlaceholder'])
      noLocal()
    }
  )

  it('does not infer method unavailability from a generic transport error message', async () => {
    const failure = new Error('method_not_found')
    runtimeEnvironmentCall.mockRejectedValue(failure)
    await expect(createRuntimeUntitledPlaceholder(context, path)).rejects.toBe(failure)
    expect(methods()).toEqual(['files.createUntitledPlaceholder'])
    noLocal()
  })

  it.each([
    ['remote', { leaseToken: token }],
    ['remote', ''],
    ['remote', 'x'.repeat(257)],
    ['local', { leaseToken: token }],
    ['local', ''],
    ['local', 'x'.repeat(257)]
  ])('rejects malformed %s creation reply %j without ordinary creation', async (route, result) => {
    const selected = route === 'local' ? localContext : context
    if (route === 'local') {
      localCreate.mockResolvedValue(result)
    } else {
      runtimeEnvironmentCall.mockResolvedValue(reply(result))
    }
    await expect(createRuntimeUntitledPlaceholder(selected, path)).rejects.toThrow()
    expect(fsCreateFile).not.toHaveBeenCalled()
    expect(fsDeletePath).not.toHaveBeenCalled()
    if (route === 'remote') {
      expect(methods()).toEqual(['files.createUntitledPlaceholder'])
      noLocal()
    } else {
      expect(localCreate).toHaveBeenCalledTimes(1)
      expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
    }
  })

  it.each([
    { status: 'removed-placeholder', recovery },
    { status: 'preserved', reason: 'not-empty' },
    { status: 'recovery-required', reason: 'restore-failed', recovery },
    { status: 'unavailable', reason: 'host-capability-unavailable' }
  ])('accepts a complete authenticated discard result %j', async (result) => {
    runtimeEnvironmentCall.mockResolvedValue(reply(result))
    expect(await discardRuntimeUntitledPlaceholder(context, path, token)).toEqual(result)
    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'files.discardUntitledPlaceholder',
      params: { ...params, leaseToken: token },
      timeoutMs: 15_000
    })
    expect(methods()).toEqual(['files.discardUntitledPlaceholder'])
    noLocal()
  })

  it.each([
    ['remote', { status: 'removed-placeholder' }],
    ['local', { status: 'removed-placeholder' }],
    ['remote', { status: 'removed-placeholder', recovery: { ...recovery, manifestPath: '' } }],
    ['local', { status: 'removed-placeholder', recovery: { ...recovery, id: '' } }]
  ])('rejects malformed %s discard success %j', async (route, result) => {
    if (route === 'local') {
      localDiscard.mockResolvedValue(result)
    } else {
      runtimeEnvironmentCall.mockResolvedValue(reply(result))
    }
    await expect(
      discardRuntimeUntitledPlaceholder(route === 'local' ? localContext : context, path, token)
    ).rejects.toThrow()
    expect(fsCreateFile).not.toHaveBeenCalled()
    expect(fsDeletePath).not.toHaveBeenCalled()
    if (route === 'remote') {
      expect(methods()).toEqual(['files.discardUntitledPlaceholder'])
      noLocal()
    } else {
      expect(localDiscard).toHaveBeenCalledTimes(1)
      expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
    }
  })

  it('releases only through the authenticated runtime with full captured owner expectations', async () => {
    runtimeEnvironmentCall.mockResolvedValue(reply(undefined))
    await expect(releaseRuntimeUntitledPlaceholder(context, path, token)).resolves.toBeUndefined()
    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'files.releaseUntitledPlaceholder',
      params: { ...params, leaseToken: token },
      timeoutMs: 15_000
    })
    expect(methods()).toEqual(['files.releaseUntitledPlaceholder'])
    noLocal()
  })

  it('uses the current direct-SSH preload methods with the full target/generation and typed results', async () => {
    localCreate.mockResolvedValue(token)
    localDiscard.mockResolvedValue({ status: 'removed-placeholder', recovery })
    localRelease.mockResolvedValue(undefined)
    expect(await createRuntimeUntitledPlaceholder(localContext, path)).toBe(token)
    expect(await discardRuntimeUntitledPlaceholder(localContext, path, token)).toEqual({
      status: 'removed-placeholder',
      recovery
    })
    await releaseRuntimeUntitledPlaceholder(localContext, path, token)
    localCreate.mockResolvedValue(null)
    expect(await createRuntimeUntitledPlaceholder(localContext, path)).toBeNull()
    const localArgs = {
      filePath: path,
      connectionId: 'build-host',
      expectedExecutionHostId: 'ssh:build-host',
      expectedSshTargetId: 'build-host',
      expectedSshConnectionGeneration: 19
    }
    expect(localCreate).toHaveBeenCalledWith(localArgs)
    expect(localDiscard).toHaveBeenCalledWith({ ...localArgs, leaseToken: token })
    expect(localRelease).toHaveBeenCalledWith({ ...localArgs, leaseToken: token })
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
    expect(fsCreateFile).not.toHaveBeenCalled()
    expect(fsDeletePath).not.toHaveBeenCalled()
  })

  it('keeps direct-SSH operational errors as refusals instead of ordinary creation', async () => {
    const failure = Object.assign(new Error('Host permission refused'), { code: 'EACCES' })
    localCreate.mockRejectedValue(failure)
    await expect(createRuntimeUntitledPlaceholder(localContext, path)).rejects.toBe(failure)
    expect(localCreate).toHaveBeenCalledTimes(1)
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
    expect(fsCreateFile).not.toHaveBeenCalled()
  })

  it.each(['create', 'discard', 'release'])(
    'rejects %s before mutation when ownership admission is missing',
    async (operation) => {
      runtimeEnvironmentTransportCall.mockResolvedValue(
        reply({
          runtimeId: 'remote-runtime',
          runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
          minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
          capabilities: []
        })
      )
      const action =
        operation === 'create'
          ? createRuntimeUntitledPlaceholder(context, path)
          : operation === 'discard'
            ? discardRuntimeUntitledPlaceholder(context, path, token)
            : releaseRuntimeUntitledPlaceholder(context, path, token)
      await expect(action).rejects.toThrow(FILE_MUTATION_OWNERSHIP_UPDATE_REQUIRED_MESSAGE)
      expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
      noLocal()
    }
  )

  it.each(['create', 'discard', 'release'])(
    'rejects %s outside the owning runtime worktree without local fallback',
    async (operation) => {
      const outside = '/outside/untitled.md'
      const action =
        operation === 'create'
          ? createRuntimeUntitledPlaceholder(context, outside)
          : operation === 'discard'
            ? discardRuntimeUntitledPlaceholder(context, outside, token)
            : releaseRuntimeUntitledPlaceholder(context, outside, token)
      await expect(action).rejects.toThrow('outside the owning runtime worktree')
      expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
      noLocal()
    }
  )
})
