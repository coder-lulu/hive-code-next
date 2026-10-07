import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTaskManagedCopy } from './task-managed-copy'
import { prepareTaskOutputWorkspace } from './task-output-workspace'
import { restoreLocalTaskWorkspace } from './local-task-workspace-recovery'
import type { TaskExecutionWorkspace } from './task-execution-record'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const evidence = resolve('logs/paperclip-development/p3/role-handoffs/workspace-recovery/tmp')
  await mkdir(evidence, { recursive: true })
  const root = await mkdtemp(join(evidence, 'fixture-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'file.ts'), 'original code')
  const copy = await createTaskManagedCopy({
    source,
    directory: join(root, 'tasks'),
    assertCurrent: () => undefined
  })
  const workspace: TaskExecutionWorkspace = {
    hostId: 'local',
    workspaceId: 'folder:original',
    isolation: 'managed_copy',
    canonicalPath: copy.canonicalPath,
    executionPath: copy.executionPath,
    directoryIdentity: copy.directoryIdentity
  }
  let folder: { folderPath: string; isArchived: boolean; connectionId: string | null } = {
    folderPath: copy.executionPath,
    isArchived: false,
    connectionId: null
  }
  const options = {
    assertCurrent: () => undefined,
    getFolderWorkspace: (id: string) => (id === 'original' ? folder : null)
  }
  return {
    workspace,
    options,
    root,
    replace: (patch: Partial<typeof folder>) => {
      folder = { ...folder, ...patch }
    }
  }
}
describe('original local workspace recovery proof', () => {
  it('reuses the exact registered folder and rejects missing original identity', async () => {
    const f = await fixture()
    restoreLocalTaskWorkspace(f.workspace, f.options).assertCurrent()
    expect(() =>
      restoreLocalTaskWorkspace({ ...f.workspace, directoryIdentity: undefined }, f.options)
    ).toThrow('OUTCOME_UNKNOWN')
  })
  it.each(['archive', 'remote', 'registration', 'identity', 'owner'] as const)(
    'fences %s changes after recovery',
    async (boundary) => {
      const f = await fixture(),
        proof = restoreLocalTaskWorkspace(f.workspace, f.options)
      if (boundary === 'archive') {
        f.replace({ isArchived: true })
      }
      if (boundary === 'remote') {
        f.replace({ connectionId: 'connection:remote' })
      }
      if (boundary === 'registration') {
        f.replace({ folderPath: f.workspace.canonicalPath })
      }
      if (boundary === 'owner') {
        f.options.assertCurrent = () => {
          throw new Error('FORBIDDEN')
        }
      }
      if (boundary === 'identity') {
        await rename(f.workspace.executionPath, `${f.workspace.executionPath}-original`)
        await mkdir(f.workspace.executionPath)
      }
      expect(() => proof.assertCurrent()).toThrow('FORBIDDEN')
    }
  )
  it('retains the tester output identity proof across recovery', async () => {
    const f = await fixture()
    f.workspace.outputDirectory = (
      await prepareTaskOutputWorkspace({
        workspace: f.workspace,
        assertCurrent: f.options.assertCurrent
      })
    ).outputDirectory
    const proof = restoreLocalTaskWorkspace(f.workspace, f.options)
    await rename(f.workspace.outputDirectory.path, `${f.workspace.outputDirectory.path}-original`)
    await mkdir(f.workspace.outputDirectory.path)
    expect(() => proof.assertCurrent()).toThrow('FORBIDDEN')
  })
})
