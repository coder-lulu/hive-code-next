// @vitest-environment happy-dom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveTaskView } from '../../../../../shared/hive-tasks'
import { useHiveTasks } from './use-hive-tasks'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement, root: Root, current: ReturnType<typeof useHiveTasks>
let accountChanged: () => void
const list = vi.fn(),
  create = vi.fn(),
  artifact = vi.fn()
const task: HiveTaskView = {
  id: 'task:test',
  title: 'Task',
  status: 'succeeded',
  artifactRefs: ['artifact:test']
}
function Harness({ open }: { open: boolean }): ReactElement {
  current = useHiveTasks(open)
  return (
    <p>
      {current.tasks.map((entry) => entry.title).join(',')}
      {current.artifact?.text}
    </p>
  )
}
beforeEach(() => {
  list.mockReset().mockResolvedValue([])
  create.mockReset().mockResolvedValue(task)
  artifact.mockReset().mockResolvedValue({ name: 'report.md', text: 'private report' })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: { list, create, artifact, cancel: vi.fn() },
      hiveAccount: {
        onStateChanged: (listener: () => void) => {
          accountChanged = listener
          return () => undefined
        }
      }
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})
describe('Codex task page account and request races', () => {
  it('keeps observing an unknown result until it settles without launching another execution', async () => {
    vi.useFakeTimers()
    const unknown: HiveTaskView = { ...task, status: 'unknown', artifactRefs: [] }
    list.mockResolvedValueOnce([unknown]).mockResolvedValueOnce([task])
    await act(async () => {
      root.render(<Harness open />)
    })
    expect(current.tasks).toEqual([unknown])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(current.tasks).toEqual([task])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })
    expect(list).toHaveBeenCalledTimes(2)
    expect(create).not.toHaveBeenCalled()
  })
  it('keeps a synchronous bridge failure inside the explicit unavailable state', async () => {
    list.mockImplementation(() => {
      throw new Error('SERVICE_UNAVAILABLE')
    })
    await act(async () => {
      root.render(<Harness open />)
    })
    expect(current.error).toBe('SERVICE_UNAVAILABLE')
    expect(current.tasks).toEqual([])
  })
  it('refreshes after an older list request settles so a newly created task is visible', async () => {
    let finishOld!: (rows: HiveTaskView[]) => void
    list.mockImplementationOnce(
      () =>
        new Promise<HiveTaskView[]>((resolve) => {
          finishOld = resolve
        })
    )
    list.mockResolvedValue([task])
    await act(async () => {
      root.render(<Harness open />)
    })
    let mutation: Promise<boolean>
    await act(async () => {
      mutation = current.create({
        requestId: 'test',
        title: 'Task',
        input: 'report',
        workspaceSelector: 'workspace:test'
      })
      finishOld([])
      await mutation
    })
    expect(list).toHaveBeenCalledTimes(2)
    expect(current.tasks).toEqual([task])
  })
  it('clears private artifact text immediately when the account changes', async () => {
    await act(async () => {
      root.render(<Harness open />)
    })
    await act(async () => {
      await current.readArtifact(task.id, 'artifact:test')
    })
    expect(current.artifact?.text).toBe('private report')
    await act(async () => {
      accountChanged()
    })
    expect(current.artifact).toBeNull()
    expect(container.textContent).not.toContain('private report')
  })
  it('ignores a pending response after the dialog closes', async () => {
    let finish!: (rows: HiveTaskView[]) => void
    list.mockImplementationOnce(
      () =>
        new Promise<HiveTaskView[]>((resolve) => {
          finish = resolve
        })
    )
    await act(async () => {
      root.render(<Harness open />)
    })
    await act(async () => {
      root.render(<Harness open={false} />)
      finish([task])
    })
    expect(current.tasks).toEqual([])
  })
})
