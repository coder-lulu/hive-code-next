import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerHiveTaskHandlers } from './hive-tasks'

type Sender = { mainFrame: object; isDestroyed(): boolean }
type Event = { sender: Sender; senderFrame: object }
const stubs = vi.hoisted(() => ({
  handlers: new Map<string, (event: Event, query: unknown) => Promise<unknown>>(),
  load: vi.fn(),
  trusted: vi.fn(),
  page: vi.fn(),
  file: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: Event, query: unknown) => Promise<unknown>) =>
      stubs.handlers.set(channel, handler)
  }
}))
vi.mock('../startup/main-process-tasks', () => ({ getLocalTasks: stubs.load }))
vi.mock('./ui', () => ({ isTrustedUIRenderer: stubs.trusted }))
const facade = () => ({ getWorkflowCaseCodePage: stubs.page, getWorkflowCaseCodeFile: stubs.file })
beforeEach(() => {
  vi.resetAllMocks()
  stubs.handlers.clear()
  stubs.trusted.mockReturnValue(true)
  stubs.load.mockResolvedValue({ facade: facade() })
  stubs.page.mockResolvedValue({ kind: 'test-page' })
  stubs.file.mockResolvedValue({ kind: 'test-file' })
  registerHiveTaskHandlers()
})
describe.each(['getWorkflowCaseCodePage', 'getWorkflowCaseCodeFile'] as const)(
  'trusted owner %s bridge',
  (method) => {
    const query = {
      projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      caseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      handoffRef: 'handoff:original',
      path: 'app.ts'
    }
    function invoke(event: Event) {
      const handler = stubs.handlers.get(`hiveTasks:${method}`)
      if (!handler) {
        throw new Error('Missing original code handler')
      }
      return handler(event, query)
    }
    function event(): Event {
      const mainFrame = {}
      return { sender: { mainFrame, isDestroyed: () => false }, senderFrame: mainFrame }
    }
    it('routes a trusted top-frame read through the original local facade', async () => {
      const expected = method === 'getWorkflowCaseCodePage' ? stubs.page : stubs.file
      await invoke(event())
      expect(stubs.load).toHaveBeenCalledOnce()
      expect(expected).toHaveBeenCalledWith(query)
    })
    it('rejects a foreign subframe before loading the native service', async () => {
      const input = event()
      input.senderFrame = {}
      await expect(invoke(input)).rejects.toThrow('FORBIDDEN')
      expect(stubs.load).not.toHaveBeenCalled()
      expect(stubs.page).not.toHaveBeenCalled()
      expect(stubs.file).not.toHaveBeenCalled()
    })
    it('rechecks UI trust after asynchronous host initialization', async () => {
      let release: (value: unknown) => void = () => undefined
      stubs.load.mockReturnValue(
        new Promise((resolve) => {
          release = resolve
        })
      )
      const waiting = invoke(event())
      stubs.trusted.mockReturnValue(false)
      release({ facade: facade() })
      await expect(waiting).rejects.toThrow('FORBIDDEN')
      expect(stubs.page).not.toHaveBeenCalled()
      expect(stubs.file).not.toHaveBeenCalled()
    })
    it('rejects a replaced main frame before returning private file content', async () => {
      const input = event()
      const target = method === 'getWorkflowCaseCodePage' ? stubs.page : stubs.file
      target.mockImplementation(async () => {
        input.sender.mainFrame = {}
        return { privateText: 'never-delivered' }
      })
      await expect(invoke(input)).rejects.toThrow('FORBIDDEN')
    })
  }
)
