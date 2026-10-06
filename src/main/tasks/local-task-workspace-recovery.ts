import { lstatSync, realpathSync } from 'node:fs'
import type { TaskExecutionWorkspace } from './task-execution-record'
import { assertTaskDirectoryIdentity } from './task-managed-copy'
import { assertTaskOutputWorkspace } from './task-output-workspace'
import { taskLaunchPathKey } from './task-launch-workspace'
import { refuseTaskExecution } from './task-execution-error'

/** Recover the original registered local folder; paths alone cannot restore its execution grant. */
export function restoreLocalTaskWorkspace(
  workspace: TaskExecutionWorkspace,
  options: {
    assertCurrent(): void
    getFolderWorkspace(
      id: string
    ): { folderPath: string; isArchived: boolean; connectionId?: string | null } | null | undefined
  }
) {
  if (!workspace.workspaceId.startsWith('folder:')) {
    return refuseTaskExecution('FORBIDDEN')
  }
  const id = workspace.workspaceId.slice('folder:'.length)
  const expected = realpathSync(workspace.executionPath)
  const guard = () => {
    options.assertCurrent()
    assertTaskDirectoryIdentity(workspace.executionPath, workspace.directoryIdentity)
    if (workspace.outputDirectory) {
      assertTaskOutputWorkspace(workspace)
    }
    const current = options.getFolderWorkspace(id)
    if (
      !current ||
      current.isArchived ||
      current.connectionId ||
      lstatSync(workspace.executionPath).isSymbolicLink() ||
      taskLaunchPathKey(realpathSync(current.folderPath)) !== taskLaunchPathKey(expected) ||
      taskLaunchPathKey(expected) !== taskLaunchPathKey(workspace.executionPath)
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
  }
  guard()
  return { assertCurrent: guard }
}
