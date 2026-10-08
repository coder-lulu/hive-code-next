// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import english from '@/i18n/locales/en.json'
import type { HiveWorkflowCaseSummary } from '../../../../../shared/hive-workflow-cases'
import { HiveWorkflowCaseBrowser } from './HiveWorkflowCaseBrowser'
import { workbenchCompany, workbenchProject, workbenchTeam } from './hive-workbench.test-fixtures'
import { workflowSnapshot } from './hive-workflow.test-fixtures'
import { workflowCaseSummary, workflowCaseView } from './hive-workflow-cases.test-fixtures'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const value = key.split('.').reduce<unknown>((node, part) => {
        return typeof node === 'object' && node !== null
          ? Object.entries(node).find(([name]) => name === part)?.[1]
          : undefined
      }, english)
      return typeof value === 'string'
        ? value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
        : key
    }
  })
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const company = workbenchCompany(1)
const team = workbenchTeam(company, workbenchProject(3, company), true)
const workflow = workflowSnapshot(team)
function summary(
  value: number,
  group: NonNullable<HiveWorkflowCaseSummary['currentStageRole']> | 'done' | 'cancelled'
): HiveWorkflowCaseSummary {
  const item = workflowCaseSummary(workflowCaseView(team, workflow, value, `Request ${value}`))
  const terminal = group === 'done' || group === 'cancelled'
  return {
    ...item,
    currentStageRef: terminal
      ? null
      : workflow.definition.stages.find((stage) => stage.role === group)!.stageRef,
    currentStageRole: terminal ? null : group,
    terminalKind: terminal ? group : null
  }
}
const groups = ['product', 'developer', 'tester', 'ops', 'done', 'cancelled'] as const
const items = groups.map((group, index) => summary(200 + index, group))
let root: Root
let container: HTMLDivElement
const onSelect = vi.fn()
const onLoadMore = vi.fn()
type Props = Parameters<typeof HiveWorkflowCaseBrowser>[0]
async function render(changes: Partial<Props> = {}) {
  await act(async () => {
    root.render(
      <HiveWorkflowCaseBrowser
        items={items}
        selectedId={null}
        disabled={false}
        hasMore={false}
        onSelect={onSelect}
        onLoadMore={onLoadMore}
        {...changes}
      />
    )
  })
}
function requestButton(item: HiveWorkflowCaseSummary) {
  return container.querySelector<HTMLButtonElement>(`[data-workflow-case-id="${item.id}"]`)!
}
async function board() {
  await act(async () => {
    const trigger = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (tab) => tab.textContent === 'Stage board'
    )!
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  })
}
beforeEach(() => {
  onSelect.mockReset()
  onLoadMore.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('loaded request presentation without execution claims', () => {
  it('shows a default list with fixed versions, business status and current roles', async () => {
    await render()
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'Request list'
    )
    expect(container.querySelectorAll('[data-workflow-case-id]')).toHaveLength(6)
    expect(requestButton(items[0]).textContent).toContain('Workflow version 1')
    expect(requestButton(items[0]).textContent).toContain('Open')
    expect(requestButton(items[0]).textContent).toContain('Current stage: Product')
    expect(requestButton(items[4]).textContent).toContain('Completed')
    expect(requestButton(items[4]).textContent).toContain('No current stage')
    expect(container.textContent).not.toMatch(
      /Running|In progress|Started|Deployed|AI decomposition complete/
    )
    expect(onSelect).not.toHaveBeenCalled()
  })
  it('groups all loaded summaries by their explicit roles and terminal outcomes', async () => {
    await render({ hasMore: true })
    await board()
    const groups = [...container.querySelectorAll('[data-workflow-case-group]')]
    expect(groups.map((group) => group.getAttribute('data-workflow-case-group'))).toEqual([
      'product',
      'developer',
      'tester',
      'ops',
      'done',
      'cancelled'
    ])
    for (const [index, group] of groups.entries()) {
      expect(
        group.querySelector('[data-workflow-case-id]')?.getAttribute('data-workflow-case-id')
      ).toBe(items[index].id)
      expect(group.textContent).toContain('Requests loaded: 1')
    }
    expect(container.textContent).toContain('Requests loaded: 6')
    expect(container.textContent).toContain('Execution status is shown in request details.')
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(0)
    expect(onSelect).not.toHaveBeenCalled()
  })
  it('selects through the original callback and marks only the acknowledged selection', async () => {
    await render()
    act(() => requestButton(items[1]).click())
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[1].id)
    expect(container.querySelector('[data-workflow-case-id][aria-pressed="true"]')).toBeNull()
    await render({ selectedId: items[1].id })
    expect(requestButton(items[1]).getAttribute('aria-pressed')).toBe('true')
    expect(requestButton(items[1]).getAttribute('data-current')).toBe('true')
    expect(container.querySelectorAll('[data-workflow-case-id][aria-pressed="true"]')).toHaveLength(
      1
    )
  })
  it('uses the same selection behavior on the board without adding an execution action', async () => {
    await render({ selectedId: items[2].id })
    await board()
    expect(requestButton(items[2]).getAttribute('aria-pressed')).toBe('true')
    act(() => requestButton(items[3]).click())
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[3].id)
    expect(container.textContent).not.toMatch(/Start current stage|Deploy now|Resume current stage/)
  })
  it('keeps paging outside both views and does not replace loaded items with total claims', async () => {
    await render({ hasMore: true, items: items.slice(0, 2) })
    const load = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Load more requests'
    )!
    act(() => load.click())
    expect(onLoadMore).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Requests loaded: 2')
    await board()
    expect(container.querySelectorAll('[data-workflow-case-id]')).toHaveLength(2)
    expect(
      [...container.querySelectorAll('button')].filter(
        (button) => button.textContent === 'Load more requests'
      )
    ).toHaveLength(1)
    await render({ hasMore: false })
    expect(container.textContent).not.toContain('Load more requests')
  })
  it('disables selection, view changes and paging immediately while requests or runs are busy', async () => {
    await render({ disabled: true, hasMore: true })
    for (const button of container.querySelectorAll<HTMLButtonElement>('button')) {
      expect(button.disabled).toBe(true)
      act(() => button.click())
    }
    expect(onSelect).not.toHaveBeenCalled()
    expect(onLoadMore).not.toHaveBeenCalled()
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'Request list'
    )
  })
  it('does not derive roles from opaque stage references', async () => {
    const item = { ...items[2], currentStageRef: 'stage:product-in-a-test-only-name' }
    await render({ items: [item] })
    await board()
    expect(
      container
        .querySelector('[data-workflow-case-group="tester"] [data-workflow-case-id]')
        ?.getAttribute('data-workflow-case-id')
    ).toBe(item.id)
    expect(
      container.querySelector('[data-workflow-case-group="product"] [data-workflow-case-id]')
    ).toBeNull()
  })
  it('keeps long CJK titles as escaped, wrapping text without fixed card dimensions', async () => {
    const title = `${'验收需求'.repeat(45)}<img src=x onerror=alert(1)>`
    const item = { ...items[0], title }
    await render({ items: [item] })
    const button = requestButton(item)
    expect(button.textContent).toContain(title)
    expect(button.querySelector('img,script')).toBeNull()
    expect(button.querySelector('.break-words')).not.toBeNull()
    expect(button.classList.contains('whitespace-normal')).toBe(true)
    expect(button.hasAttribute('style')).toBe(false)
  })
})
