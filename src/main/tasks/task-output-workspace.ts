import { lstat, mkdtemp, chmod } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { TaskExecutionWorkspace } from './task-execution-record'
import { assertTaskDirectoryIdentity } from './task-managed-copy'
import { taskLaunchPathKey } from './task-launch-workspace'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { refuseTaskExecution } from './task-execution-error'

export type TaskOutputDirectory = NonNullable<TaskExecutionWorkspace['outputDirectory']>
type CodeWorkspace = Pick<TaskExecutionWorkspace, 'executionPath' | 'directoryIdentity'>

export function assertTaskOutputWorkspace(
  workspace: CodeWorkspace & Pick<TaskExecutionWorkspace, 'outputDirectory'>
): void {
  const output = workspace.outputDirectory
  if (
    !output ||
    !isAbsolute(output.path) ||
    /[,\0\r\n]/.test(output.path) ||
    taskLaunchPathKey(dirname(output.path)) !==
      taskLaunchPathKey(dirname(workspace.executionPath)) ||
    taskLaunchPathKey(output.path) === taskLaunchPathKey(workspace.executionPath)
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  assertTaskDirectoryIdentity(workspace.executionPath, workspace.directoryIdentity)
  assertTaskDirectoryIdentity(output.path, output.directoryIdentity)
  if (
    workspace.directoryIdentity?.dev === output.directoryIdentity.dev &&
    workspace.directoryIdentity.ino === output.directoryIdentity.ino
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
}

/** The authenticated host creates reports outside the immutable code snapshot. */
export async function prepareTaskOutputWorkspace(options: {
  workspace: CodeWorkspace
  assertCurrent(): void
}): Promise<{ outputDirectory: TaskOutputDirectory; assertCurrent(): void }> {
  const assertCode = () => {
    assertTaskAuthorizationCurrent(() => options.assertCurrent())
    assertTaskDirectoryIdentity(
      options.workspace.executionPath,
      options.workspace.directoryIdentity
    )
  }
  assertCode()
  const path = await mkdtemp(join(dirname(options.workspace.executionPath), 'hive-task-outputs-'))
  assertCode()
  await chmod(path, 0o700)
  assertCode()
  const stats = await lstat(path, { bigint: true })
  const outputDirectory = Object.freeze({
    path,
    directoryIdentity: Object.freeze({
      dev: String(stats.dev),
      ino: String(stats.ino),
      birthtimeNs: String(stats.birthtimeNs)
    })
  })
  const assertCurrent = () => {
    assertCode()
    assertTaskOutputWorkspace({ ...options.workspace, outputDirectory })
  }
  assertCurrent()
  return { outputDirectory, assertCurrent }
}
