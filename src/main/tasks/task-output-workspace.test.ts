import { lstat, mkdir, rename, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { taskDockerFixture } from './task-docker-boundary.test-fixture'
import { assertTaskOutputWorkspace, prepareTaskOutputWorkspace } from './task-output-workspace'

describe('independent private tester output workspace', () => {
  it('creates a private sibling with exact identity and leaves the code tree unchanged', async () => {
    const h = await taskDockerFixture(
      resolve('logs/paperclip-development/p3/role-handoffs/docker-tester/tmp')
    )
    const output = await prepareTaskOutputWorkspace({
      workspace: h.options.record.workspace,
      assertCurrent: h.options.assertCurrent
    })
    expect(dirname(output.outputDirectory.path)).toBe(
      dirname(h.options.record.workspace.executionPath)
    )
    expect(output.outputDirectory.path).not.toBe(h.options.record.workspace.executionPath)
    const stat = await lstat(output.outputDirectory.path)
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o077).toBe(0)
    }
    expect(() => output.assertCurrent()).not.toThrow()
    await writeFile(join(output.outputDirectory.path, 'report.md'), 'independent report')
    expect(() =>
      assertTaskOutputWorkspace({
        ...h.options.record.workspace,
        outputDirectory: output.outputDirectory
      })
    ).not.toThrow()
  })

  it('rejects replacement, symlink aliases, code-nested paths, and missing proof', async () => {
    const h = await taskDockerFixture(
      resolve('logs/paperclip-development/p3/role-handoffs/docker-tester/tmp')
    )
    const output = await prepareTaskOutputWorkspace({
      workspace: h.options.record.workspace,
      assertCurrent: h.options.assertCurrent
    })
    const workspace = { ...h.options.record.workspace, outputDirectory: output.outputDirectory }
    expect(() => assertTaskOutputWorkspace({ ...workspace, outputDirectory: undefined })).toThrow()
    expect(() =>
      assertTaskOutputWorkspace({
        ...workspace,
        outputDirectory: {
          ...output.outputDirectory,
          path: h.options.record.workspace.executionPath
        }
      })
    ).toThrow()
    const nested = join(h.options.record.workspace.executionPath, 'nested')
    await mkdir(nested)
    expect(() =>
      assertTaskOutputWorkspace({
        ...workspace,
        outputDirectory: {
          ...output.outputDirectory,
          path: nested
        }
      })
    ).toThrow()
    const original = `${output.outputDirectory.path}-original`
    await rename(output.outputDirectory.path, original)
    await mkdir(output.outputDirectory.path)
    expect(() => output.assertCurrent()).toThrow('FORBIDDEN')
    const alias = join(h.root, 'outputs-alias')
    await symlink(original, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() =>
      assertTaskOutputWorkspace({
        ...workspace,
        outputDirectory: {
          ...output.outputDirectory,
          path: alias
        }
      })
    ).toThrow('FORBIDDEN')
  })

  it('retains the original host authority on its output guard', async () => {
    const h = await taskDockerFixture(
      resolve('logs/paperclip-development/p3/role-handoffs/docker-tester/tmp')
    )
    const output = await prepareTaskOutputWorkspace({
      workspace: h.options.record.workspace,
      assertCurrent: h.options.assertCurrent
    })
    h.revoke()
    expect(() => output.assertCurrent()).toThrow('revoked')
  })
})
