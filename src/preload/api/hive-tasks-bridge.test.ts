import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hiveTasksApi } from './hive-tasks-bridge'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined)
})

describe('Hive task run bridge', () => {
  it('requests only the original business run and bounded page controls for session reading', async () => {
    const query = {
      projectId: '11111111-1111-4111-8111-111111111111',
      caseId: '22222222-2222-4222-8222-222222222222',
      taskId: '33333333-3333-4333-8333-333333333333',
      runId: '44444444-4444-4444-8444-444444444444',
      direction: 'before' as const,
      cursor: { epoch: 'original-epoch', sequence: 40 },
      limit: 40
    }
    await hiveTasksApi.getWorkflowCaseSessionPage(query)
    expect(invoke.mock.calls).toEqual([['hiveTasks:getWorkflowCaseSessionPage', query]])
  })
  it('keeps cancellation scoped to the selected attempt', async () => {
    await hiveTasksApi.cancel('task:test', 'run:first')
    await hiveTasksApi.cancel('task:test', 'run:second')
    expect(invoke.mock.calls).toEqual([
      ['hiveTasks:cancel', 'task:test', 'run:first'],
      ['hiveTasks:cancel', 'task:test', 'run:second']
    ])
  })

  it('keeps immutable artifact authorization scoped to its original run', async () => {
    await hiveTasksApi.artifact('task:test', 'run:first', 'artifact:first')
    expect(invoke).toHaveBeenCalledWith(
      'hiveTasks:artifact',
      'task:test',
      'run:first',
      'artifact:first'
    )
  })
})
