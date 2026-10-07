// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import { HiveWorkflowCaseCode } from './HiveWorkflowCaseCode'
import {
  workflowCaseCodeFixture,
  workflowCodeTextDigest
} from './hive-workflow-case-code.test-fixtures'
import {
  deferredWorkbenchValue,
  workbenchId,
  workbenchAccountState,
  workbenchAccountBoundaryStates,
  workbenchAccountRefreshStates
} from './hive-workbench.test-fixtures'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      `${key}${options ? ` ${JSON.stringify(options)}` : ''}`
  })
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const api = { getWorkflowCaseCodePage: vi.fn(), getWorkflowCaseCodeFile: vi.fn() }
const account = { getState: vi.fn() }
const listeners = new Set<(state: HiveAccountState) => void>()
let root: Root, container: HTMLDivElement
let f: ReturnType<typeof workflowCaseCodeFixture>
function button(label: string) {
  const match = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  if (!match) {
    throw new Error(`Missing ${label}`)
  }
  return match
}
async function mount(view = f.view) {
  await act(async () => root.render(<HiveWorkflowCaseCode view={view} />))
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function load() {
  await click('hiveWorkflowCases.code.loadFiles')
}
async function read() {
  await click(f.file.path)
}
function secondHandoff() {
  return {
    ...f.handoff,
    handoffRef: 'handoff:development-2',
    producer: {
      ...f.handoff.producer,
      task: { ...f.handoff.producer.task, runId: workbenchId(950), attempt: 2, taskRevision: '2' }
    },
    codeVersion: {
      ...f.codeVersion,
      snapshot: {
        ...f.codeVersion.snapshot,
        artifactRef: `artifact:${'e'.repeat(64)}`,
        digest: 'e'.repeat(64)
      },
      treeDigest: 'f'.repeat(64)
    }
  }
}
async function choose(ref: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('#hive-case-code-version')!.click()
  )
  const option = document.querySelector<HTMLElement>(`[role="option"][data-value="${ref}"]`)
  if (!option) {
    throw new Error('Missing fixed handoff option')
  }
  await act(async () => option.click())
}
beforeEach(() => {
  f = workflowCaseCodeFixture()
  Object.values(api).forEach((mock) => mock.mockReset())
  api.getWorkflowCaseCodePage.mockResolvedValue(f.page)
  api.getWorkflowCaseCodeFile.mockResolvedValue(f.preview)
  account.getState.mockReset().mockResolvedValue(workbenchAccountState())
  listeners.clear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveTasks: api,
      hiveAccount: {
        ...account,
        onStateChanged: (listener: (state: HiveAccountState) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
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

describe('owner read-only fixed development code', () => {
  it('shows no accepted Developer result without loading or subscribing', async () => {
    await mount({ ...f.view, handoffs: [], reviews: [] })
    expect(container.textContent).toContain('hiveWorkflowCases.code.empty')
    expect(api.getWorkflowCaseCodePage).not.toHaveBeenCalled()
    expect(account.getState).not.toHaveBeenCalled()
  })
  it('loads only on demand despite unavailable execution and preserves escaped UTF-8/BOM text', async () => {
    await mount()
    expect(api.getWorkflowCaseCodePage).not.toHaveBeenCalled()
    expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(false)
    await load()
    expect(api.getWorkflowCaseCodePage).toHaveBeenCalledWith({
      projectId: f.scope.projectId,
      caseId: f.view.id,
      handoffRef: f.handoff.handoffRef,
      limit: 50,
      after: undefined
    })
    await read()
    expect(api.getWorkflowCaseCodeFile).toHaveBeenCalledWith({
      projectId: f.scope.projectId,
      caseId: f.view.id,
      handoffRef: f.handoff.handoffRef,
      path: f.file.path
    })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    expect(textarea.value).toBe(f.text)
    expect(textarea.readOnly).toBe(true)
    expect(textarea.getAttribute('aria-label')).toBe(f.file.path)
    expect(container.querySelectorAll('script,iframe')).toHaveLength(0)
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe(f.file.path)
    textarea.focus()
    expect(document.activeElement).toBe(textarea)
  })
  it('keeps only one page, binds next cursor to the fixed snapshot, and returns to first page', async () => {
    const files = Array.from({ length: 50 }, (_, i) => ({
      path: `src/file-${String(i).padStart(2, '0')}.ts`,
      size: 0,
      digest: workflowCodeTextDigest(''),
      executableBits: 0
    }))
    const cursor = { snapshotRef: f.codeVersion.snapshot.artifactRef, afterPath: files[49].path }
    api.getWorkflowCaseCodePage
      .mockResolvedValueOnce({ ...f.page, files, nextCursor: cursor })
      .mockResolvedValueOnce({ ...f.page, files: [{ ...files[0], path: 'src/file-50.ts' }] })
      .mockResolvedValueOnce(f.page)
    await mount()
    await load()
    expect(container.querySelectorAll('[data-code-file-row]')).toHaveLength(50)
    await click('hiveWorkflowCases.code.nextPage')
    expect(api.getWorkflowCaseCodePage.mock.calls[1][0].after).toEqual(cursor)
    expect(container.querySelectorAll('[data-code-file-row]')).toHaveLength(1)
    expect(container.textContent).not.toContain(files[0].path)
    expect(button('hiveWorkflowCases.code.nextPage').disabled).toBe(true)
    await load()
    expect(api.getWorkflowCaseCodePage.mock.calls[2][0].after).toBeUndefined()
    expect(container.textContent).toContain(f.file.path)
  })
  it('holds a synchronous single flight and disables keyboard-reachable read controls immediately', async () => {
    const pending = deferredWorkbenchValue<unknown>()
    api.getWorkflowCaseCodePage.mockReturnValue(pending.promise)
    await mount()
    await act(async () => {
      button('hiveWorkflowCases.code.loadFiles').click()
      button('hiveWorkflowCases.code.loadFiles').click()
    })
    expect(api.getWorkflowCaseCodePage).toHaveBeenCalledOnce()
    expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(true)
    expect(button('hiveWorkflowCases.code.nextPage').disabled).toBe(true)
    await act(async () => pending.resolve(f.page))
    expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(false)
  })
  it('retains the selected old snapshot when a newer handoff and same-Case polling arrive', async () => {
    await mount()
    await load()
    await read()
    const next = secondHandoff()
    await mount({ ...f.view, revision: f.view.revision + 1, handoffs: [...f.view.handoffs, next] })
    expect(container.querySelector('textarea')?.value).toBe(f.text)
    expect(container.querySelector('[data-code-version]')?.textContent).toContain(
      f.codeVersion.treeDigest
    )
    expect(api.getWorkflowCaseCodePage).toHaveBeenCalledOnce()
    await choose(next.handoffRef)
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('[data-code-version]')?.textContent).toContain(
      next.codeVersion.treeDigest
    )
    expect(api.getWorkflowCaseCodePage).toHaveBeenCalledOnce()
  })
  it('discards a late file response when a different handoff is selected', async () => {
    const next = secondHandoff()
    await mount({ ...f.view, handoffs: [next, ...f.view.handoffs] })
    await load()
    const pending = deferredWorkbenchValue<unknown>()
    api.getWorkflowCaseCodeFile.mockReturnValue(pending.promise)
    await read()
    await choose(next.handoffRef)
    await act(async () => pending.resolve(f.preview))
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).not.toContain(f.text)
  })
  it.each(['page', 'file'] as const)(
    'discards late %s data across a Case boundary',
    async (pendingKind) => {
      await mount()
      if (pendingKind === 'file') {
        await load()
      }
      const pending = deferredWorkbenchValue<unknown>()
      api[
        pendingKind === 'page' ? 'getWorkflowCaseCodePage' : 'getWorkflowCaseCodeFile'
      ].mockReturnValue(pending.promise)
      await (pendingKind === 'page' ? load() : read())
      const next: HiveWorkflowCaseView = {
        ...f.view,
        id: workbenchId(990),
        binding: { ...f.view.binding, workflowRunRef: workbenchId(990) }
      }
      await mount(next)
      await act(async () => pending.resolve(pendingKind === 'page' ? f.page : f.preview))
      expect(container.querySelectorAll('[data-code-file-row]')).toHaveLength(0)
      expect(container.querySelector('textarea')).toBeNull()
    }
  )
  it('clears loaded private data if a selected handoff version is replaced or removed', async () => {
    await mount()
    await load()
    await read()
    const changed = { ...secondHandoff(), handoffRef: f.handoff.handoffRef }
    await mount({ ...f.view, handoffs: [changed] })
    expect(container.querySelector('textarea')).toBeNull()
    expect(api.getWorkflowCaseCodePage).toHaveBeenCalledOnce()
    await mount({ ...f.view, handoffs: [] })
    expect(container.textContent).toContain('hiveWorkflowCases.code.empty')
  })
  it('discards a late file response when the same handoff fixed version changes', async () => {
    await mount()
    await load()
    const pending = deferredWorkbenchValue<unknown>()
    api.getWorkflowCaseCodeFile.mockReturnValue(pending.promise)
    await read()
    const changed = { ...secondHandoff(), handoffRef: f.handoff.handoffRef }
    await mount({ ...f.view, handoffs: [changed] })
    await act(async () => pending.resolve(f.preview))
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelector('[data-code-version]')?.textContent).toContain(
      changed.codeVersion.treeDigest
    )
  })
  it.each(
    workbenchAccountBoundaryStates(workbenchAccountState()).map(
      (item) => [item.name, item.state] as const
    )
  )('clears private data and late results on %s', async (_, state) => {
    await mount()
    await load()
    await read()
    const pending = deferredWorkbenchValue<unknown>()
    api.getWorkflowCaseCodeFile.mockReturnValue(pending.promise)
    await read()
    await act(async () => {
      listeners.forEach((listener) => listener(state))
      pending.resolve(f.preview)
    })
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelectorAll('[data-code-file-row]')).toHaveLength(0)
    expect(container.textContent).toContain('hiveWorkflowCases.code.errors.forbidden')
    expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(true)
  })
  it('retains the private view during same-owner access-token/display metadata refresh', async () => {
    await mount()
    await load()
    await read()
    await act(async () =>
      workbenchAccountRefreshStates(workbenchAccountState()).forEach((state) =>
        listeners.forEach((listener) => listener(state))
      )
    )
    expect(container.querySelector('textarea')?.value).toBe(f.text)
    expect(api.getWorkflowCaseCodePage).toHaveBeenCalledOnce()
  })
  it('clears private data when the observed long session expires without an event', async () => {
    vi.useFakeTimers()
    account.getState.mockResolvedValue({
      ...workbenchAccountState(),
      sessionExpiresAt: Date.now() + 1000
    })
    await mount()
    await load()
    await read()
    await act(async () => vi.advanceTimersByTimeAsync(1001))
    expect(container.querySelector('textarea')).toBeNull()
    expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(true)
  })
  it('rearms expiry on same-owner renewal, retains data past the old deadline and clears at the new deadline', async () => {
    vi.useFakeTimers()
    const initial = { ...workbenchAccountState(), sessionExpiresAt: Date.now() + 1000 }
    account.getState.mockResolvedValue(initial)
    await mount()
    await load()
    await read()
    await act(async () => vi.advanceTimersByTimeAsync(500))
    const renewed = { ...initial, sessionExpiresAt: Date.now() + 5000 }
    await act(async () => listeners.forEach((listener) => listener(renewed)))
    await act(async () => vi.advanceTimersByTimeAsync(501))
    expect(container.querySelector('textarea')?.value).toBe(f.text)
    expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(false)
    expect(api.getWorkflowCaseCodePage).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(4500))
    expect(container.querySelector('textarea')).toBeNull()
    expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(true)
  })
  it.each(['older-valid', 'older-signed-out', 'older-failure'] as const)(
    'keeps the newer metadata timer/ready when initial getState returns %s late',
    async (failure) => {
      vi.useFakeTimers()
      const initial = { ...workbenchAccountState(), sessionExpiresAt: Date.now() + 1000 }
      const pending = deferredWorkbenchValue<HiveAccountState>()
      account.getState.mockReturnValueOnce(pending.promise).mockResolvedValue(initial)
      await mount()
      expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(true)
      const renewed = { ...initial, sessionExpiresAt: Date.now() + 5000 }
      await act(async () => listeners.forEach((listener) => listener(renewed)))
      expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(false)
      await act(async () => {
        if (failure === 'older-failure') {
          pending.reject(new Error('stale account read'))
        } else {
          pending.resolve(
            failure === 'older-signed-out'
              ? { configured: true, status: 'signed-out', persistence: 'none' }
              : initial
          )
        }
      })
      await load()
      await read()
      await act(async () => vi.advanceTimersByTimeAsync(1001))
      expect(container.querySelector('textarea')?.value).toBe(f.text)
      expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(false)
      await act(async () => vi.advanceTimersByTimeAsync(4000))
      expect(container.querySelector('textarea')).toBeNull()
      expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(true)
    }
  )
  it('keeps an initially signed-out owner unavailable', async () => {
    account.getState.mockResolvedValue({
      configured: true,
      status: 'signed-out',
      persistence: 'none'
    })
    await mount()
    expect(button('hiveWorkflowCases.code.loadFiles').disabled).toBe(true)
    expect(api.getWorkflowCaseCodePage).not.toHaveBeenCalled()
  })
  it.each(['binary', 'too_large'] as const)(
    'shows %s metadata without a text preview',
    async (reason) => {
      const file = {
        ...f.file,
        path: 'assets/result.bin',
        size: reason === 'too_large' ? 262145 : 3,
        digest: 'e'.repeat(64)
      }
      api.getWorkflowCaseCodePage.mockResolvedValue({ ...f.page, files: [file] })
      api.getWorkflowCaseCodeFile.mockResolvedValue({
        ...f.preview,
        file,
        preview: { kind: 'unavailable', reason }
      })
      await mount()
      await load()
      await click(file.path)
      expect(container.textContent).toContain(`hiveWorkflowCases.code.previewUnavailable.${reason}`)
      expect(container.textContent).toContain(file.digest)
      expect(container.querySelector('textarea')).toBeNull()
    }
  )
  it('clears preview after an invalid text digest and keeps the refusal explicit', async () => {
    await mount()
    await load()
    await read()
    api.getWorkflowCaseCodeFile.mockResolvedValue({
      ...f.preview,
      preview: { kind: 'text', text: f.text.replace('value', 'VALUE') }
    })
    await read()
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).toContain('hiveWorkflowCases.code.errors.invalidResponse')
  })
  it('clears private data and exposes a service refusal without claiming a readable result', async () => {
    await mount()
    await load()
    await read()
    api.getWorkflowCaseCodePage.mockRejectedValue(new Error('SOURCE_UNAVAILABLE'))
    await load()
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.querySelectorAll('[data-code-file-row]')).toHaveLength(0)
    expect(container.textContent).toContain('hiveWorkflowCases.code.errors.unavailable')
  })
})
