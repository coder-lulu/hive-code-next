import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'
import type { TaskExecutionWorkspace } from './task-execution-record'
import { readTaskCodeTree, taskCodeTreeDigest } from './task-code-snapshot-tree'
import { refuseTaskExecution } from './task-execution-error'

/** Restore the fixed-code proof from bytes, rather than accepting the old folder identity alone. */
export async function restoreTaskWorkflowCopyGuard(
  workspace: TaskExecutionWorkspace,
  command: TaskExecutionStart,
  assertCurrent: () => void
) {
  if (command.workflowContext?.role !== 'tester') {
    return null
  }
  const version = command.workflowContext.codeInput?.version
  if (version?.kind !== 'snapshot') {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  const tree = await readTaskCodeTree(workspace.executionPath, assertCurrent)
  assertCurrent()
  if (taskCodeTreeDigest(tree.tree) !== version.treeDigest) {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  return {
    assertCurrent,
    assertUnchanged() {
      assertCurrent()
      tree.assertUnchanged()
    }
  }
}
