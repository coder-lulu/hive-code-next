// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HiveWorkflowGraph, type HiveWorkflowGraphCaseFacts } from './HiveWorkflowGraph'
import { branchingGraphStages, graphStages } from './hive-workflow-graph.test-fixtures'
import type { WorkflowStage } from './hive-workflow-draft'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: { index?: number; status?: string; stage?: string; stages?: string }
    ) =>
      key === 'hiveWorkflow.stageLabel'
        ? `Stage ${options?.index}`
        : key === 'hiveWorkflowCases.graph.businessStatus'
          ? `Business: ${options?.status}`
          : options?.stages || options?.stage
            ? `${key}: ${options.stages ?? options.stage}`
            : key
  })
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const selected = vi.fn()
const frames = new Map<number, FrameRequestCallback>()
const observers = new Set<GraphResizeObserver>()
let sequence = 0,
  width = 900
let root: Root, container: HTMLDivElement
let nodes: WorkflowStage[]
class GraphResizeObserver implements ResizeObserver {
  observed = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) {
    observers.add(this)
  }
  observe(target: Element) {
    this.observed.add(target)
  }
  unobserve(target: Element) {
    this.observed.delete(target)
  }
  disconnect() {
    this.observed.clear()
    observers.delete(this)
  }
}
function box(x: number, y: number, width: number, height: number): DOMRect {
  return new DOMRect(x, y, width, height)
}
function measuredBox(element: Element) {
  if (element.classList.contains('hive-workflow-graph-canvas')) {
    return box(10, 20, width, 700)
  }
  if (element.classList.contains('hive-workflow-graph-width-probe')) {
    return box(0, 0, 160, 0)
  }
  if (element.classList.contains('hive-workflow-graph-gap-probe')) {
    return box(0, 0, 48, 12)
  }
  if (element instanceof HTMLElement && element.dataset.workflowNodeKey) {
    const index = [...element.parentElement!.children].indexOf(element)
    const horizontal =
      element.closest('[data-orientation]')?.getAttribute('data-orientation') === 'horizontal'
    return horizontal
      ? box(22 + index * 208, 44, 160, 100)
      : box(34, 32 + index * 148, Math.max(40, width - 68), 100)
  }
  return box(0, 0, 0, 0)
}
async function mount(
  options: {
    stages?: WorkflowStage[]
    busy?: boolean
    picked?: string | null
    facts?: HiveWorkflowGraphCaseFacts
  } = {}
) {
  await act(async () => {
    root.render(
      <HiveWorkflowGraph
        stages={options.stages ?? nodes}
        selected={options.picked ?? nodes[0].stageRef}
        disabled={options.busy ?? false}
        onSelect={selected}
        caseFacts={options.facts}
      />
    )
  })
}
async function resize() {
  await act(async () => {
    for (const observer of observers) {
      observer.callback([], observer)
    }
    for (const observer of observers) {
      observer.callback([], observer)
    }
  })
}
async function flushFrames() {
  await act(async () => {
    const pending = [...frames.values()]
    frames.clear()
    pending.forEach((callback) => callback(0))
  })
}
beforeEach(() => {
  selected.mockReset()
  nodes = graphStages()
  frames.clear()
  observers.clear()
  sequence = 0
  width = 900
  vi.stubGlobal('ResizeObserver', GraphResizeObserver)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++sequence
      frames.set(id, callback)
      return id
    })
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id))
  )
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    return measuredBox(this)
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('native workflow graph nodes and measured connections', () => {
  it('keeps plain stage buttons, authored numbering and readable configuration relationships', async () => {
    await mount({ stages: branchingGraphStages() })
    expect([...container.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Stage 3',
      'Stage 2',
      'Stage 5',
      'Stage 4',
      'Stage 1'
    ])
    expect(container.querySelectorAll('ol > li')).toHaveLength(5)
    expect(container.querySelector('h3')?.textContent).toBe('hiveWorkflow.flowView')
    expect(container.textContent).toContain('hiveWorkflow.returnSummary: Stage 5')
    expect(container.textContent).toContain('hiveWorkflow.graphLegend')
    expect(container.querySelectorAll('[data-workflow-stage-task]')).toHaveLength(0)
    const target = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stage 5'
    )!
    target.focus()
    expect(document.activeElement).toBe(target)
    act(() => target.click())
    expect(selected).toHaveBeenCalledWith('developer')
  })
  it('preserves historical selection while busy disables native buttons immediately', async () => {
    await mount({ picked: 'tester' })
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stage 3'
    )!
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.disabled).toBe(false)
    await mount({ busy: true, picked: 'tester' })
    act(() => button.click())
    expect(selected).not.toHaveBeenCalled()
    expect([...container.querySelectorAll('button')].every((button) => button.disabled)).toBe(true)
  })
  it('renders only supplied Case business states outside stage button names and actual current ref', async () => {
    const facts: HiveWorkflowGraphCaseFacts = {
      currentStageRef: 'tester',
      stageTasks: [
        { stageRef: 'product', status: 'done' },
        { stageRef: 'developer', status: 'in_review' },
        { stageRef: 'tester', status: 'blocked' }
      ]
    }
    await mount({ facts })
    expect(container.querySelectorAll('[data-workflow-stage-task]')).toHaveLength(3)
    expect(container.querySelector('h4')?.textContent).toBe('hiveWorkflow.flowView')
    expect(container.textContent).toContain('Business: hiveWorkflowCases.statuses.blocked')
    expect(container.textContent).toContain('hiveWorkflowCases.graph.statusUnavailable')
    expect([...container.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Stage 1',
      'Stage 2',
      'Stage 3',
      'Stage 4'
    ])
    expect(container.querySelector('button[aria-current=step]')?.textContent).toBe('Stage 3')
    await mount({ facts: { ...facts, currentStageRef: null } })
    expect(container.querySelector('[data-workflow-current-stage]')).toBeNull()
    expect(container.querySelector('[aria-current]')).toBeNull()
  })
  it('keeps cyclic or missing relationships visible and selectable with a truthful fallback', async () => {
    const invalid = graphStages()
    invalid[0] = { ...invalid[0], dependsOn: ['ops', 'missing'] }
    await mount({ stages: invalid })
    expect(container.querySelector('[data-workflow-graph-valid=false]')).not.toBeNull()
    expect(container.textContent).toContain('hiveWorkflow.graphInvalidLayout')
    expect(container.textContent).toContain('hiveWorkflow.unknownStage')
    expect(container.querySelectorAll('ol > li')).toHaveLength(4)
    act(() => container.querySelector('button')!.click())
    expect(selected).toHaveBeenCalledWith('product')
  })
  it('draws only measured connectors, coalesces resize and clears observers/frames at disposal', async () => {
    await mount()
    expect(container.querySelector('[data-orientation=horizontal]')).not.toBeNull()
    expect(
      container.querySelector('svg[data-workflow-graph-edges]')?.getAttribute('aria-hidden')
    ).toBe('true')
    expect(container.querySelectorAll('[data-workflow-edge-kind=dependency]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-workflow-edge-kind=return]')).toHaveLength(1)
    expect(
      container.querySelector('[data-workflow-edge-kind=return]')?.getAttribute('stroke-dasharray')
    ).toBe('4 2')
    expect(
      container
        .querySelector('[data-workflow-edge-kind=dependency]')
        ?.hasAttribute('stroke-dasharray')
    ).toBe(false)
    await resize()
    expect(frames.size).toBe(1)
    await flushFrames()
    expect(frames.size).toBe(0)
    width = 360
    await resize()
    await flushFrames()
    expect(container.querySelector('[data-orientation=vertical]')).not.toBeNull()
    expect(container.querySelectorAll('[data-workflow-edge-kind]')).toHaveLength(4)
    await resize()
    const late = [...frames.values()]
    act(() => root.unmount())
    expect(observers.size).toBe(0)
    expect(frames.size).toBe(0)
    act(() => late.forEach((callback) => callback(0)))
    root = createRoot(container)
    await mount()
    expect(container.querySelectorAll('[data-workflow-edge-kind]')).toHaveLength(4)
  })
  it('does not invent SVG positions when the original DOM layout is unavailable', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(box(0, 0, 0, 0))
    await mount()
    expect(container.querySelector('svg[data-workflow-graph-edges]')).toBeNull()
    expect(container.querySelectorAll('ol > li')).toHaveLength(4)
  })
})
