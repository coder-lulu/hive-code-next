import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import type {
  RuntimeMobileSessionTabsSnapshot,
  RuntimeSyncWindowGraph
} from '../../shared/runtime-types'
import type { TerminalLayoutSnapshot } from '../../shared/terminal-tab-types'

const WORKTREE = 'repo::/workspace'
const TAB = 'tab-runtime'
const LEAF = '11111111-1111-4111-8111-111111111111'
const OTHER_LEAF = '22222222-2222-4222-8222-222222222222'
const PTY = 'pty-runtime'
const INCARNATION = 'incarnation-runtime'

function graph(ptyId: string | null, version: number): RuntimeSyncWindowGraph {
  return {
    tabs: [
      {
        tabId: TAB,
        worktreeId: WORKTREE,
        title: 'Runtime terminal',
        activeLeafId: LEAF,
        layout: null
      }
    ],
    leaves: [{ tabId: TAB, worktreeId: WORKTREE, leafId: LEAF, paneRuntimeId: 1, ptyId }],
    mobileSessionTabs: [
      {
        worktree: WORKTREE,
        publicationEpoch: 'renderer',
        snapshotVersion: version,
        activeTabId: `${TAB}::${LEAF}`,
        activeTabType: 'terminal',
        activeGroupId: null,
        tabs: [
          {
            type: 'terminal',
            id: `${TAB}::${LEAF}`,
            title: 'Runtime terminal',
            parentTabId: TAB,
            leafId: LEAF,
            ptyId,
            incarnationId: ptyId ? INCARNATION : null,
            parentLayout: {
              root: { type: 'leaf', leafId: LEAF },
              activeLeafId: LEAF,
              expandedLeafId: null,
              ptyIdsByLeafId: ptyId ? { [LEAF]: ptyId } : {}
            },
            isActive: true
          }
        ]
      }
    ]
  }
}

class RuntimeFixture extends OrcaRuntimeService {
  setRuntimeOwned(owned: boolean): void {
    const pty = this.ptysById.get(PTY)
    if (!pty) {
      throw new Error('Missing registered fixture PTY')
    }
    pty.runtimeSessionOwned = owned
  }

  setOtherRuntimeOwned(): void {
    const pty = this.ptysById.get('pty-other')
    if (!pty) {
      throw new Error('Missing split fixture PTY')
    }
    pty.runtimeSessionOwned = true
  }

  snapshot(): RuntimeMobileSessionTabsSnapshot | undefined {
    return this.mobileSessionTabsByWorktree.get(WORKTREE)
  }

  binding(): string | null | undefined {
    return this.leaves.get(this.getLeafKey(TAB, LEAF))?.ptyId
  }
}

function setup() {
  const runtime = new RuntimeFixture(null)
  const write = vi.fn(() => true)
  runtime.setPtyController({ write, kill: () => true, getForegroundProcess: async () => null })
  runtime.attachWindow(1)
  runtime.registerPty(PTY, WORKTREE, null, { tabId: TAB, leafId: LEAF, incarnationId: INCARNATION })
  runtime.setRuntimeOwned(true)
  runtime.syncWindowGraph(1, graph(PTY, 1))
  return { runtime, write }
}

describe('runtime-owned PTY projection repair', () => {
  it('keeps one original surface and handle across a null graph and mobile projection', async () => {
    const { runtime, write } = setup()
    const [before] = (await runtime.listTerminals()).terminals
    runtime.syncWindowGraph(1, graph(null, 2))
    const after = (await runtime.listTerminals()).terminals
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({
      handle: before.handle,
      tabId: TAB,
      leafId: LEAF,
      ptyId: PTY,
      incarnationId: INCARNATION,
      connected: true,
      writable: true
    })
    expect(runtime.snapshot()?.tabs).toMatchObject([
      {
        parentTabId: TAB,
        leafId: LEAF,
        ptyId: PTY,
        incarnationId: INCARNATION,
        parentLayout: { ptyIdsByLeafId: { [LEAF]: PTY } }
      }
    ])
    await expect(runtime.readTerminal(before.handle)).resolves.toMatchObject({
      handle: before.handle,
      status: 'running'
    })
    await runtime.sendTerminal(
      before.handle,
      { text: 'original owner', enter: true },
      { inputKind: 'driving' }
    )
    expect(write.mock.calls).toEqual([
      [PTY, 'original owner', 'driving'],
      [PTY, '\r', 'driving']
    ])
    runtime.syncWindowGraph(1, graph(PTY, 3))
    expect((await runtime.listTerminals()).terminals).toMatchObject([{ handle: before.handle }])
  })

  it('keeps a renderer-owned null binding unbound', () => {
    const { runtime } = setup()
    runtime.setRuntimeOwned(false)
    runtime.syncWindowGraph(1, graph(null, 2))
    expect(runtime.binding()).toBeNull()
  })

  it('does not restore a PTY whose host cannot verify liveness', () => {
    const { runtime } = setup()
    runtime.markPtyLivenessUnverifiable(PTY, 'Lost contact with the owning host')
    runtime.syncWindowGraph(1, graph(null, 2))
    expect(runtime.binding()).toBeNull()
  })

  it('does not restore a PTY while its requested stop is pending', () => {
    const { runtime } = setup()
    runtime.markPtyStopRequested(PTY)
    runtime.syncWindowGraph(1, graph(null, 2))
    expect(runtime.binding()).toBeNull()
  })

  it('does not claim a PTY mapped to a different split leaf in the publication', () => {
    const { runtime } = setup()
    const incoming = graph(null, 2)
    const surface = incoming.mobileSessionTabs![0].tabs[0]
    if (surface.type !== 'terminal') {
      throw new Error('Missing terminal fixture')
    }
    surface.parentLayout!.ptyIdsByLeafId = { [OTHER_LEAF]: PTY }
    runtime.syncWindowGraph(1, incoming)
    expect(runtime.binding()).toBeNull()
  })

  it('rejects a competing pane even when its publication reuses the surface id', () => {
    const { runtime } = setup()
    const incoming = graph(null, 2)
    const surface = incoming.mobileSessionTabs![0].tabs[0]
    if (surface.type !== 'terminal') {
      throw new Error('Missing terminal fixture')
    }
    incoming.mobileSessionTabs![0].tabs.push({
      ...surface,
      leafId: OTHER_LEAF,
      ptyId: PTY,
      incarnationId: INCARNATION
    })
    runtime.syncWindowGraph(1, incoming)
    expect(runtime.binding()).toBeNull()
  })

  it.each([false, true])(
    'repairs split panes without losing layout or handles (reverse=%s)',
    async (reverse) => {
      const { runtime } = setup()
      runtime.registerPty('pty-other', WORKTREE, null, {
        tabId: TAB,
        leafId: OTHER_LEAF,
        incarnationId: 'incarnation-other'
      })
      runtime.setOtherRuntimeOwned()
      const splitGraph = (missing: boolean, version: number): RuntimeSyncWindowGraph => {
        const incoming = graph(missing ? null : PTY, version)
        const layout: TerminalLayoutSnapshot = {
          root: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.4,
            first: { type: 'leaf', leafId: LEAF },
            second: { type: 'leaf', leafId: OTHER_LEAF }
          },
          activeLeafId: OTHER_LEAF,
          expandedLeafId: OTHER_LEAF,
          ptyIdsByLeafId: missing ? {} : { [LEAF]: PTY, [OTHER_LEAF]: 'pty-other' },
          titlesByLeafId: { [LEAF]: 'Original', [OTHER_LEAF]: 'Other' },
          buffersByLeafId: { [OTHER_LEAF]: 'retained output' }
        }
        const surface = incoming.mobileSessionTabs![0].tabs[0]
        if (surface.type !== 'terminal') {
          throw new Error('Missing terminal fixture')
        }
        surface.parentLayout = layout
        incoming.mobileSessionTabs![0].tabs.push({
          ...surface,
          id: `${TAB}::${OTHER_LEAF}`,
          leafId: OTHER_LEAF,
          ptyId: missing ? null : 'pty-other',
          incarnationId: missing ? null : 'incarnation-other'
        })
        incoming.leaves.push({
          tabId: TAB,
          worktreeId: WORKTREE,
          leafId: OTHER_LEAF,
          paneRuntimeId: 2,
          ptyId: missing ? null : 'pty-other'
        })
        if (reverse) {
          incoming.leaves.reverse()
        }
        return incoming
      }
      const beforeGraph = splitGraph(false, 2)
      runtime.syncWindowGraph(1, beforeGraph)
      const before = (await runtime.listTerminals()).terminals
      runtime.syncWindowGraph(1, splitGraph(true, 3))
      const after = (await runtime.listTerminals()).terminals
      expect(after).toHaveLength(2)
      expect(
        after.map(({ handle, ptyId, tabId, leafId }) => ({ handle, ptyId, tabId, leafId }))
      ).toEqual(
        before.map(({ handle, ptyId, tabId, leafId }) => ({ handle, ptyId, tabId, leafId }))
      )
      const originalSurface = beforeGraph.mobileSessionTabs![0].tabs[0]
      if (originalSurface.type !== 'terminal') {
        throw new Error('Missing terminal fixture')
      }
      expect(runtime.snapshot()?.tabs).toHaveLength(2)
      for (const surface of runtime.snapshot()!.tabs) {
        expect(surface).toMatchObject({ parentLayout: originalSurface.parentLayout })
      }
    }
  )

  it('does not reuse an earlier PTY incarnation', () => {
    const { runtime } = setup()
    runtime.registerPty(PTY, WORKTREE, null, {
      tabId: TAB,
      leafId: LEAF,
      incarnationId: 'replacement'
    })
    runtime.syncWindowGraph(1, graph(null, 2))
    expect(runtime.binding()).toBeNull()
  })

  it('does not recreate a surface missing from the current publication', () => {
    const { runtime } = setup()
    const incoming = graph(null, 2)
    incoming.mobileSessionTabs![0].tabs = []
    runtime.syncWindowGraph(1, incoming)
    expect(runtime.binding()).toBeNull()
  })

  it('does not recover a removed graph leaf', () => {
    const { runtime } = setup()
    const incoming = graph(null, 2)
    incoming.leaves = []
    runtime.syncWindowGraph(1, incoming)
    expect(runtime.binding()).toBeUndefined()
  })

  it('does not overwrite a replacement binding', () => {
    const { runtime } = setup()
    runtime.syncWindowGraph(1, graph('replacement-pty', 2))
    expect(runtime.binding()).toBe('replacement-pty')
  })

  it('does not duplicate a PTY the graph already assigns to another leaf', () => {
    const { runtime } = setup()
    const incoming = graph(null, 2)
    incoming.leaves.push({
      tabId: TAB,
      worktreeId: WORKTREE,
      leafId: OTHER_LEAF,
      paneRuntimeId: 2,
      ptyId: PTY
    })
    runtime.syncWindowGraph(1, incoming)
    expect(runtime.binding()).toBeNull()
  })
})
