import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hiveTasksApi } from './hive-tasks-bridge'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined)
})

describe('Hive task run bridge', () => {
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
