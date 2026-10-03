/** @vitest-environment happy-dom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardAgentRow as DashboardAgentRowData } from '@/components/dashboard/useDashboardData'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CompactAgentExpansion } from './worktree-card-compact-agents'
import { CompactAgentRow } from './worktree-card-compact-agent-row'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/dashboard/use-agent-row-conversation-name', () => ({
  useAgentRowConversationName: () => null
}))

vi.mock('./CacheTimer', () => ({
  default: () => null,
  usePromptCacheCountdownForPane: () => null
}))

function makeAgent({
  stateStartedAt,
  lastAssistantMessage,
  state = 'working'
}: {
  stateStartedAt: number
  lastAssistantMessage?: string
  state?: string
}): DashboardAgentRowData {
  return {
    paneKey: 'tab-1:leaf-1',
    tab: { id: 'tab-1' },
    agentType: 'claude',
    state,
    startedAt: 500,
    entry: {
      prompt: 'do the task',
      state,
      stateStartedAt,
      lastAssistantMessage,
      paneKey: 'tab-1:leaf-1',
      updatedAt: stateStartedAt
    }
  } as unknown as DashboardAgentRowData
}

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  document.body.replaceChildren()
})

function renderRow(agent: DashboardAgentRowData): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <TooltipProvider>
        <CompactAgentRow agent={agent} now={2000} onActivate={() => {}} />
      </TooltipProvider>
    )
  })
  return container
}

function rerenderRow(agent: DashboardAgentRowData): void {
  act(() => {
    root!.render(
      <TooltipProvider>
        <CompactAgentRow agent={agent} now={2000} onActivate={() => {}} />
      </TooltipProvider>
    )
  })
}

describe('CompactAgentRow stable assistant message', () => {
  it('uses a single title with model details on hover and activates the tree row by keyboard', () => {
    const agent = makeAgent({ stateStartedAt: 1000, lastAssistantMessage: 'Details only' })
    agent.entry.model = 'model-detail'
    const onActivate = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root!.render(
        <TooltipProvider>
          <CompactAgentRow projectTree agent={agent} now={2000} onActivate={onActivate} />
        </TooltipProvider>
      )
    )
    expect(container.textContent).toContain('do the task')
    expect(container.textContent).not.toContain('Details only')
    expect(container.textContent).not.toContain('model-detail')
    expect(container.querySelector('[title*="model-detail"]')).not.toBeNull()
    const row = container.querySelector<HTMLElement>('.project-tree-session-row')!
    act(() => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onActivate).toHaveBeenCalledWith('tab-1', 'tab-1:leaf-1')
  })
  it('holds the last assistant line when a same-turn ping omits it', () => {
    const container = renderRow(
      makeAgent({ stateStartedAt: 1000, lastAssistantMessage: 'First reply' })
    )
    expect(container.textContent).toContain('First reply')

    rerenderRow(makeAgent({ stateStartedAt: 1000 }))
    expect(container.textContent).toContain('First reply')
  })

  it('drops the held line when a new turn starts', () => {
    const container = renderRow(
      makeAgent({ stateStartedAt: 1000, lastAssistantMessage: 'First reply' })
    )
    rerenderRow(makeAgent({ stateStartedAt: 3000 }))
    expect(container.textContent).not.toContain('First reply')
  })

  it('never holds across pings for entries without a turn identity (stateStartedAt 0)', () => {
    const container = renderRow(makeAgent({ stateStartedAt: 0, lastAssistantMessage: 'Turn one' }))
    expect(container.textContent).toContain('Turn one')

    rerenderRow(makeAgent({ stateStartedAt: 0 }))
    expect(container.textContent).not.toContain('Turn one')
  })

  it('drops the held line when the agent leaves working', () => {
    const container = renderRow(
      makeAgent({ stateStartedAt: 1000, lastAssistantMessage: 'First reply' })
    )
    rerenderRow(makeAgent({ stateStartedAt: 1000, state: 'done' }))
    rerenderRow(makeAgent({ stateStartedAt: 1000, state: 'working' }))
    expect(container.textContent).not.toContain('First reply')
  })
})

it.each(['eligible', 'disabled', 'sending'] as const)(
  'preserves %s send-target behavior for project row clicks',
  (status) => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onActivate = vi.fn()
    const onSendTargetClick = vi.fn()
    act(() =>
      root!.render(
        <TooltipProvider>
          <CompactAgentRow
            projectTree
            agent={makeAgent({ stateStartedAt: 1000 })}
            now={2000}
            onActivate={onActivate}
            sendTargetStatus={status}
            onSendTargetClick={onSendTargetClick}
          />
        </TooltipProvider>
      )
    )
    act(() => container.querySelector<HTMLElement>('.project-tree-session-row span')!.click())
    expect(onActivate).not.toHaveBeenCalled()
    expect(onSendTargetClick).toHaveBeenCalledTimes(status === 'eligible' ? 1 : 0)
  }
)

it.each([false, true])(
  'ArrowLeft returns from a nested row to its parent (has children: %s)',
  (hasChildren) => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const closeWorkspace = vi.fn()
    const toggleChild = vi.fn()
    const agent = makeAgent({ stateStartedAt: 1000 })
    act(() =>
      root!.render(
        <TooltipProvider>
          <div data-worktree-card-surface="true">
            <button className="project-tree-disclosure" onClick={closeWorkspace}>
              Workspace
            </button>
            <div className="project-tree-sessions">
              <CompactAgentRow
                projectTree
                agent={agent}
                now={2000}
                onActivate={() => {}}
                childAgentCount={1}
                childAgentsExpanded
                onToggleChildAgents={() => {}}
              />
              <CompactAgentExpansion expanded>
                <div className="worktree-agent-lineage-children">
                  <CompactAgentRow
                    projectTree
                    agent={agent}
                    now={2000}
                    onActivate={() => {}}
                    childAgentCount={hasChildren ? 1 : undefined}
                    childAgentsExpanded={false}
                    onToggleChildAgents={hasChildren ? toggleChild : undefined}
                  />
                </div>
              </CompactAgentExpansion>
            </div>
          </div>
        </TooltipProvider>
      )
    )
    const rows = container.querySelectorAll<HTMLElement>('.project-tree-session-row')
    rows[1].focus()
    act(() =>
      rows[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    )
    expect(document.activeElement).toBe(rows[0])
    expect(closeWorkspace).not.toHaveBeenCalled()
    expect(toggleChild).not.toHaveBeenCalled()
  }
)
