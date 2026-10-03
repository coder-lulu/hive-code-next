import { describe, expect, it, vi } from 'vitest'
import {
  OrcaRuntimeService,
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from './orca-runtime-test-mocks.spec'
import { mkdir } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import {
  TEST_FOLDER_WORKSPACE_KEY,
  createFolderWorkspaceRuntimeStore,
  makeFolderProjectGroup,
  makeFolderWorkspace
} from './orca-runtime-test-fixtures.spec'

describe('folder model discovery target', () => {
  it.each([undefined, 'ssh-folder'])(
    'resolves a folder on %s without requiring Git',
    async (connectionId) => {
      const folderPath = connectionId
        ? '/srv/platform'
        : resolvePath('logs/p5-folder-model-fixture')
      if (connectionId) {
        registerSshFilesystemProvider(connectionId, {
          stat: vi.fn().mockResolvedValue({ type: 'directory', size: 0, mtime: 1 })
        } as never)
      } else {
        await mkdir(folderPath, { recursive: true })
      }
      const runtime = new OrcaRuntimeService(
        createFolderWorkspaceRuntimeStore(
          makeFolderWorkspace({ folderPath, ...(connectionId ? { connectionId } : {}) }),
          makeFolderProjectGroup({ parentPath: folderPath })
        ) as never
      )
      const resolve = (
        runtime as unknown as {
          resolveRuntimeGitTarget(
            selector: string,
            options?: { allowFolderWorkspace?: boolean }
          ): Promise<unknown>
        }
      ).resolveRuntimeGitTarget.bind(runtime)
      await expect(
        resolve(`id:${TEST_FOLDER_WORKSPACE_KEY}`, { allowFolderWorkspace: true })
      ).resolves.toMatchObject({
        worktree: { path: folderPath },
        executionHostId: connectionId ? `ssh:${connectionId}` : 'local'
      })
      await expect(resolve(`id:${TEST_FOLDER_WORKSPACE_KEY}`)).rejects.toThrow('selector_not_found')
      if (connectionId) {
        unregisterSshFilesystemProvider(connectionId)
      }
    }
  )
})
