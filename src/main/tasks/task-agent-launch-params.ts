import { AgentLaunchReplay } from '../../shared/rpc-contract/agent-launch-params'
import type { TaskExecutionRecord } from './task-execution-record'

export function taskAgentLaunchParams(
  record: TaskExecutionRecord,
  input: string,
  executor: 'hivecode' | 'codex'
) {
  return AgentLaunchReplay.parse({
    agent: executor,
    operationId: record.command.operationId,
    target: { kind: 'existing', worktree: `id:${record.workspace.workspaceId}` },
    prompt: { text: input, delivery: 'submit' },
    agentArgs: null,
    cwd: record.workspace.executionPath,
    presentation: 'background'
  })
}
