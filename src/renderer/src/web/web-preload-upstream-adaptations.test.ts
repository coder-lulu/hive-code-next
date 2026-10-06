import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchResults } from '../../../shared/ai-vault-search-test-fixture'
import { unavailableSessionSearchStatus } from '../../../shared/ai-vault-search-client'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

describe('active web preload upstream adaptations', () => {
  const call = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    call.mockReset()
    vi.doMock('./web-runtime-client', () => ({
      WebRuntimeClient: class {
        call = call
        close(): void {}
      }
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('./web-runtime-client')
  })

  async function installPairedApi() {
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'owning-host')
    const { installWebPreloadApi } = await import('./web-preload-api')
    installWebPreloadApi()
    return { api: globals.window.api }
  }

  it('routes search through the selected client and redacts host-local resume data', async () => {
    call.mockResolvedValue({
      id: 'search',
      ok: true,
      result: searchResults(),
      _meta: { runtimeId: 'runtime-1' }
    })
    const { api } = await installPairedApi()
    const result = await api.aiVault.searchSessions({ query: 'needle' }, 'runtime:owning-host')
    expect(call).toHaveBeenCalledWith(
      'aiVault.searchSessions',
      {
        query: 'needle',
        limit: 20,
        supportedAgents: [
          'claude',
          'codebuddy',
          'qoder',
          'codex',
          'hermes',
          'pi',
          'omp',
          'prime-agent',
          'cursor',
          'gemini',
          'antigravity',
          'rovo',
          'copilot',
          'opencode',
          'opencode2',
          'zcode',
          'grok',
          'openclaw',
          'devin',
          'droid',
          'cline',
          'kimi',
          'muse',
          'jcode'
        ],
        supportsQoderHistory: true,
        supportsJcodeHistory: true
      },
      { timeoutMs: undefined }
    )
    expect(result).toMatchObject({ kind: 'results', hits: [{ source: { presence: 'present' } }] })
    expect(JSON.stringify(result)).not.toContain('resumeCommand')
    expect(result).not.toHaveProperty('debug')
    call.mockResolvedValue({
      id: 'status',
      ok: true,
      result: unavailableSessionSearchStatus(),
      _meta: { runtimeId: 'runtime-1' }
    })
    await expect(api.aiVault.searchStatus()).resolves.toEqual(unavailableSessionSearchStatus())
    expect(call).toHaveBeenLastCalledWith('aiVault.searchStatus', {}, { timeoutMs: undefined })
  })

  it('refuses another execution host without invoking the paired client', async () => {
    const { api } = await installPairedApi()
    for (const scope of ['runtime:other-host', 'ssh:box', 'local'] as const) {
      await expect(api.aiVault.searchSessions({ query: 'needle' }, scope)).resolves.toEqual({
        kind: 'unavailable',
        reason: 'no-service'
      })
      await expect(api.aiVault.searchStatus(scope)).resolves.toEqual(
        unavailableSessionSearchStatus()
      )
    }
    await expect(api.aiVault.searchSessions({ query: 'needle' }, 'all')).resolves.toEqual({
      kind: 'unavailable',
      reason: 'no-service'
    })
    expect(call).not.toHaveBeenCalled()
  })

  it('propagates transport failures and rejects invalid search responses', async () => {
    const { api } = await installPairedApi()
    call.mockRejectedValue(new Error('disconnected'))
    await expect(api.aiVault.searchSessions({ query: 'needle' })).rejects.toThrow('disconnected')
    await expect(api.aiVault.searchStatus()).rejects.toThrow('disconnected')
    call.mockResolvedValue({
      id: 'search',
      ok: true,
      result: { kind: 'results' },
      _meta: { runtimeId: 'runtime-1' }
    })
    await expect(api.aiVault.searchSessions({ query: 'needle' })).rejects.toThrow()
  })

  it('implements ordered batch path checks through the active runtime catalog', async () => {
    call.mockImplementation(async (method: string) => ({
      id: method,
      ok: true,
      _meta: { runtimeId: 'runtime-1' },
      result:
        method === 'repo.list'
          ? { repos: [{ id: 'repo-1', path: '/srv/repo' }] }
          : {
              repoId: 'repo-1',
              authoritative: true,
              source: 'git',
              worktrees: [{ id: 'tree-1', repoId: 'repo-1', path: '/srv/repo' }]
            }
    }))
    const { api } = await installPairedApi()
    await expect(
      api.shell.pathsExist?.(['/srv/repo/file.ts', '/outside/file.ts'])
    ).resolves.toEqual([true, false])
    await expect(api.shell.pathsExist?.([])).resolves.toEqual([])
    expect(call.mock.calls.map(([method]) => method)).toContain('worktree.detectedList')
  })

  it('rejects local streaming upload instead of returning an undefined fallback result', async () => {
    const { api } = await installPairedApi()
    await expect(
      api.fs.uploadExternalFileToRuntime({
        environmentId: 'owning-host',
        sourceRootPath: '/client/file.txt',
        entryRelativePath: '',
        expected: { byteLength: 1, inode: 1, deviceId: 1, modifiedAtMs: 1 },
        worktree: 'tree-1',
        relativePath: 'file.txt'
      })
    ).rejects.toThrow('Uploading local files is not supported in the web client')
    expect(call).not.toHaveBeenCalled()
  })
})
