import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { isWslUncPath } from '../../shared/wsl-paths'
import type { RpcContext } from '../runtime/rpc/core'
import type { TaskExecutionWorkspace } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

export function taskLaunchPathKey(path: string) {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/** Resolve the same workspace selector the launch handler uses, before admitting its effect. */
export async function requireTaskLaunchWorkspace(
  context: RpcContext,
  workspace: TaskExecutionWorkspace
) {
  const scope = await context.runtime.showTerminalWorkspaceLaunchScope(
    `id:${workspace.workspaceId}`
  )
  if (
    scope.connectionId !== null ||
    (process.platform === 'win32' &&
      [scope.path, workspace.executionPath, workspace.canonicalPath].some(isWslUncPath))
  ) {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  if (
    scope.id !== workspace.workspaceId ||
    ![scope.path, workspace.executionPath, workspace.canonicalPath].every(isAbsolute)
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  try {
    const [execution, actual, source, executionStats] = await Promise.all([
      realpath(workspace.executionPath),
      realpath(scope.path),
      realpath(workspace.canonicalPath),
      stat(workspace.executionPath)
    ])
    if (
      !executionStats.isDirectory() ||
      taskLaunchPathKey(execution) !== taskLaunchPathKey(workspace.executionPath) ||
      taskLaunchPathKey(actual) !== taskLaunchPathKey(execution) ||
      taskLaunchPathKey(source) === taskLaunchPathKey(execution)
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    return { scope, executionPath: execution }
  } catch {
    return refuseTaskExecution('FORBIDDEN')
  }
}
