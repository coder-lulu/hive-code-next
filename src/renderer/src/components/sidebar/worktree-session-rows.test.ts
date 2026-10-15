import { describe, expect, it } from 'vitest'
import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { structuredAgentSessionPaneKey } from '../../../../shared/structured-agent-session-projection'
import { buildWorktreeAgentRows } from './worktree-agent-rows'
import { buildWorktreeSessionRows } from './worktree-session-rows'

const LEAF = '11111111-1111-4111-8111-111111111111'
const layout = {
  root: { type: 'leaf' as const, leafId: LEAF },
  activeLeafId: LEAF,
  expandedLeafId: null
}

function terminal(id: string, overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id,
    worktreeId: 'folder:workspace',
    ptyId: null,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 100,
    launchAgent: 'codex',
    restoredFromSession: true,
    ...overrides
  }
}

function structured(id: string): Tab {
  return {
    id,
    entityId: `session-${id}`,
    worktreeId: 'folder:workspace',
    groupId: 'group',
    contentType: 'agent-session',
    agentSessionAgent: 'codex',
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 100
  }
}

describe('buildWorktreeSessionRows', () => {
  it('shows every restored terminal conversation before any pane is mounted', () => {
    const tabs = [terminal('first'), terminal('second'), terminal('third')]
    const rows = buildWorktreeSessionRows({
      agents: [],
      tabs,
      unifiedTabs: [],
      terminalLayoutsByTabId: Object.fromEntries(tabs.map((tab) => [tab.id, layout]))
    })

    expect(rows.map((row) => row.paneKey)).toEqual(tabs.map((tab) => makePaneKey(tab.id, LEAF)))
    expect(
      rows.every((row) => row.state === 'unverifiable' && row.entry.stateStartedAt === 0)
    ).toBe(true)
  })

  it('shows restored structured conversations before the host status feed arrives', () => {
    const tabs = [structured('first'), structured('second')]
    const rows = buildWorktreeSessionRows({
      agents: [],
      tabs: [],
      unifiedTabs: tabs,
      terminalLayoutsByTabId: {}
    })

    expect(rows.map((row) => row.paneKey)).toEqual(
      tabs.map((tab) => structuredAgentSessionPaneKey(tab.id, tab.entityId))
    )
    expect(rows.map((row) => row.entry.prompt)).toEqual(['first', 'second'])
    expect(rows.every((row) => row.state === 'unverifiable')).toBe(true)
  })

  it('uses reported status in place of an inventory row without duplicating the conversation', () => {
    const tab = terminal('first')
    const paneKey = makePaneKey(tab.id, LEAF)
    const agents = buildWorktreeAgentRows({
      tabs: [tab],
      entries: [
        {
          paneKey,
          state: 'done',
          prompt: 'Finished',
          agentType: 'codex',
          worktreeId: tab.worktreeId,
          stateStartedAt: 500,
          updatedAt: 500,
          stateHistory: []
        }
      ],
      retained: [],
      now: 600
    })
    const rows = buildWorktreeSessionRows({
      agents,
      tabs: [tab],
      unifiedTabs: [],
      terminalLayoutsByTabId: { first: layout }
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toBe(agents[0])
    expect(rows[0].state).toBe('done')
  })

  it('keeps structured live and retained rows without duplicate inventory rows', () => {
    const tab = structured('first')
    const paneKey = structuredAgentSessionPaneKey(tab.id, tab.entityId)
    const agents = buildWorktreeAgentRows({
      tabs: [],
      entries: [
        {
          paneKey,
          state: 'done',
          prompt: 'Finished',
          agentType: 'codex',
          worktreeId: tab.worktreeId,
          stateStartedAt: 500,
          updatedAt: 500,
          stateHistory: []
        }
      ],
      retained: [],
      now: 600
    })
    const rows = buildWorktreeSessionRows({
      agents,
      tabs: [],
      unifiedTabs: [tab],
      terminalLayoutsByTabId: {}
    })
    expect(rows).toEqual(agents)
  })

  it('does not turn plain shells or ambiguous split panes into agent conversations', () => {
    const tabs = [terminal('shell', { launchAgent: undefined }), terminal('split')]
    const rows = buildWorktreeSessionRows({
      agents: [],
      tabs,
      unifiedTabs: [],
      terminalLayoutsByTabId: {
        shell: layout,
        split: {
          ...layout,
          root: {
            type: 'split',
            direction: 'horizontal',
            first: layout.root,
            second: { type: 'leaf', leafId: '22222222-2222-4222-8222-222222222222' }
          }
        }
      }
    })
    expect(rows).toEqual([])
  })

  it('keeps a saved provider conversation visible without launch metadata', () => {
    const tab = terminal('saved', {
      launchAgent: undefined,
      aiVaultTitle: { agent: 'codex', sessionId: 'provider-session', title: 'Saved conversation' }
    })
    const rows = buildWorktreeSessionRows({
      agents: [],
      tabs: [tab],
      unifiedTabs: [],
      terminalLayoutsByTabId: { saved: layout }
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].agentType).toBe('codex')
    expect(rows[0].entry.prompt).toBe('Saved conversation')
  })

  it('does not restore an agent row after the foreground has returned to the shell', () => {
    const tab = terminal('exited', { restoredFromSession: undefined, title: 'project' })
    const rows = buildWorktreeSessionRows({
      agents: [],
      tabs: [tab],
      unifiedTabs: [],
      terminalLayoutsByTabId: { exited: layout },
      paneForegroundAgentByPaneKey: {
        [makePaneKey(tab.id, LEAF)]: { agent: null, shellForeground: true }
      }
    })
    expect(rows).toEqual([])
  })

  it('does not assign the old tab agent to a shell surviving a closed split pane', () => {
    const tab = terminal('surviving-shell')
    const survivorLeaf = '22222222-2222-4222-8222-222222222222'
    const rows = buildWorktreeSessionRows({
      agents: [],
      tabs: [tab],
      unifiedTabs: [],
      terminalLayoutsByTabId: {
        [tab.id]: {
          ...layout,
          root: { type: 'leaf', leafId: survivorLeaf },
          activeLeafId: survivorLeaf
        }
      },
      paneForegroundAgentByPaneKey: {
        [makePaneKey(tab.id, survivorLeaf)]: { agent: null, shellForeground: true }
      }
    })
    expect(rows).toEqual([])
  })

  it('removes an unreported conversation as soon as its tab closes', () => {
    expect(
      buildWorktreeSessionRows({
        agents: [],
        tabs: [],
        unifiedTabs: [],
        terminalLayoutsByTabId: {}
      })
    ).toEqual([])
  })
})
