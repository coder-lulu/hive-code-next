// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useLinearWorkspaceManagement } from './use-linear-workspace-management'
const mocks = vi.hoisted(() => ({
  testLinearConnection: vi.fn(),
  checkLinearConnection: vi.fn(async () => {}),
  disconnectLinearWorkspace: vi.fn(async () => {})
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks) => unknown) => selector(mocks)
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  vi.clearAllMocks()
})
it('allows testing a replacement key without an older request clearing its pending state', async () => {
  const resolvers: ((value: { ok: boolean }) => void)[] = []
  mocks.testLinearConnection.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve)
      })
  )
  let current: ReturnType<typeof useLinearWorkspaceManagement> | undefined
  function Harness() {
    current = useLinearWorkspaceManagement()
    return null
  }
  function controller() {
    if (!current) {
      throw new Error('Hook not mounted')
    }
    return current
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))
  let request: Promise<void> | undefined
  await act(async () => {
    request = controller().runTest('workspace-1')
  })
  await act(async () => {
    controller().authorizationCompleted()
  })
  expect(controller().testing.size).toBe(0)
  let replacementRequest: Promise<void> | undefined
  await act(async () => {
    replacementRequest = controller().runTest('workspace-1')
  })
  expect(mocks.testLinearConnection).toHaveBeenCalledTimes(2)
  await act(async () => {
    resolvers[0]({ ok: true })
    await request
  })
  expect(controller().testing.has('workspace-1')).toBe(true)
  expect(controller().results['workspace-1']).toBeUndefined()
  await act(async () => {
    resolvers[1]({ ok: false })
    await replacementRequest
  })
  expect(controller().results['workspace-1']).toEqual({ ok: false })
  expect(controller().testing.size).toBe(0)
})
