import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { taskTestDirectory } from './task-execution.test-fixture'
import { createTaskManagedCopy } from './task-managed-copy'

let root = ''
afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  root = await taskTestDirectory()
  const source = join(root, 'source')
  await mkdir(source)
  return { source, directory: join(root, 'copies'), assertCurrent: () => undefined }
}
describe('task workspace isolation', () => {
  it('keeps dirty/untracked files and preserves later user edits in an independent copy', async () => {
    const options = await fixture()
    await writeFile(join(options.source, 'dirty.txt'), 'uncommitted')
    await mkdir(join(options.source, '.git'))
    await writeFile(join(options.source, '.git', 'config'), 'private git config')
    const copy = await createTaskManagedCopy(options)
    await writeFile(join(copy.executionPath, 'dirty.txt'), 'task write')
    expect(await readFile(join(options.source, 'dirty.txt'), 'utf8')).toBe('uncommitted')
    await writeFile(join(options.source, 'dirty.txt'), 'later user edit')
    expect(await readFile(join(copy.executionPath, 'dirty.txt'), 'utf8')).toBe('task write')
    await expect(readFile(join(copy.executionPath, '.git', 'config'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
  it('rejects a symlink to an outside directory without reading or copying its contents', async () => {
    const options = await fixture()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(options.source, 'escape'), 'junction')
    await expect(createTaskManagedCopy(options)).rejects.toThrow('CAPABILITY_UNAVAILABLE')
  })
  it('refuses a destination nested within the source', async () => {
    const options = await fixture()
    await expect(
      createTaskManagedCopy({ ...options, directory: join(options.source, 'copies') })
    ).rejects.toThrow('FORBIDDEN')
  })
  it('stops copying immediately when authorization is revoked', async () => {
    const options = await fixture()
    await writeFile(join(options.source, 'file.txt'), 'safe')
    let calls = 0
    await expect(
      createTaskManagedCopy({
        ...options,
        assertCurrent: () => {
          if (++calls > 2) {
            throw new Error('revoked')
          }
        }
      })
    ).rejects.toThrow('revoked')
    expect(await readFile(join(options.source, 'file.txt'), 'utf8')).toBe('safe')
  })
})
