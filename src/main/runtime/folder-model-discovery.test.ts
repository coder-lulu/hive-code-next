import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime-test-mocks.spec'
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
      if (!connectionId) {
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
      if (connectionId) {
        await expect(resolve(`id:${TEST_FOLDER_WORKSPACE_KEY}`, { allowFolderWorkspace: true })).rejects.toThrow(`folder_workspace_path_unavailable:${folderPath}`)
        return
      }
      await expect(
        resolve(`id:${TEST_FOLDER_WORKSPACE_KEY}`, { allowFolderWorkspace: true })
      ).resolves.toMatchObject({
        worktree: { path: folderPath },
        executionHostId: connectionId ? `ssh:${connectionId}` : 'local'
      })
      await expect(resolve(`id:${TEST_FOLDER_WORKSPACE_KEY}`)).rejects.toThrow('selector_not_found')
    }
  )
})
