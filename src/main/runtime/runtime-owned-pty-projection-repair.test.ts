import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import type {
  RuntimeMobileSessionTabsSnapshot,
  RuntimeRendererSyncWindowGraph,
  RuntimeSyncWindowGraph
} from '../../shared/runtime-types'
import type { TerminalLayoutSnapshot } from '../../shared/terminal-tab-types'

const WORKTREE = 'repo::/workspace'
const TAB = 'tab-runtime'
const LEAF = '11111111-1111-4111-8111-111111111111'
const OTHER_LEAF = '22222222-2222-4222-8222-222222222222'
const PTY = 'pty-runtime'
const INCARNATION = 'incarnation-runtime'

function graph(
  ptyId: string | null,
  version: number,
  omitIncarnation = false
): RuntimeSyncWindowGraph {
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
            ...(omitIncarnation ? {} : { incarnationId: ptyId ? INCARNATION : null }),
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

  forgetRendererPublication(): void {
    this.acceptedRendererMobileSnapshotByWorktree.delete(WORKTREE)
  }
}

function setup(unmounted = false, omitIncarnation = false) {
  const runtime = new RuntimeFixture(null)
  const write = vi.fn(() => true)
  runtime.setPtyController({ write, kill: () => true, getForegroundProcess: async () => null })
  runtime.attachWindow(1)
  runtime.registerPty(PTY, WORKTREE, null, { tabId: TAB, leafId: LEAF, incarnationId: INCARNATION })
  runtime.setRuntimeOwned(true)
  const initial = graph(PTY, 1, omitIncarnation)
  runtime.syncWindowGraph(1, unmounted ? { ...initial, tabs: [], leaves: [] } : initial)
  return { runtime, write }
}

describe('runtime-owned PTY projection repair', () => {
  it.each([
    'renderer-owned',
    'unverifiable',
    'stopping',
    'declared-replacement',
    'native-replacement',
    'competing-graph',
    'competing-layout',
    'duplicate-publication',
    'missing-layout',
    'replacement-worktree',
    'replacement-surface',
    'prior-competing-layout',
    'prior-replacement-pty'
  ])('does not certify a renderer binding without native authority (%s)', (reason) => {
    const { runtime } = setup()
    if (reason === 'prior-competing-layout' || reason === 'prior-replacement-pty') {
      const prior = graph(PTY, 2, true)
      const priorSurface = prior.mobileSessionTabs![0].tabs[0]
      if (priorSurface.type !== 'terminal') {
        throw new Error('Missing prior terminal fixture')
      }
      if (reason === 'prior-competing-layout') {
        priorSurface.parentLayout!.ptyIdsByLeafId = { [LEAF]: PTY, [OTHER_LEAF]: PTY }
      } else {
        priorSurface.ptyId = 'replacement-pty'
      }
      runtime.syncWindowGraph(1, prior)
    }
    const incoming = graph(PTY, 3, true)
    const surface = incoming.mobileSessionTabs![0].tabs[0]
    if (surface.type !== 'terminal') {
      throw new Error('Missing terminal fixture')
    }
    if (reason === 'renderer-owned') {
      runtime.setRuntimeOwned(false)
    }
    if (reason === 'unverifiable') {
      runtime.markPtyLivenessUnverifiable(PTY, 'Host unavailable')
    }
    if (reason === 'stopping') {
      runtime.markPtyStopRequested(PTY)
    }
    if (reason === 'declared-replacement') {
      surface.incarnationId = 'replacement'
    }
    if (reason === 'native-replacement') {
      runtime.registerPty(PTY, WORKTREE, null, {
        tabId: TAB,
        leafId: LEAF,
        incarnationId: 'replacement'
      })
    }
    if (reason === 'competing-graph') {
      incoming.leaves.push({ ...incoming.leaves[0], leafId: OTHER_LEAF, paneRuntimeId: 2 })
    }
    if (reason === 'competing-layout') {
      surface.parentLayout!.ptyIdsByLeafId = { [LEAF]: PTY, [OTHER_LEAF]: PTY }
    }
    if (reason === 'duplicate-publication') {
      incoming.mobileSessionTabs![0].tabs.push({ ...surface, id: 'duplicate' })
    }
    if (reason === 'missing-layout') {
      surface.parentLayout = undefined
    }
    if (reason === 'replacement-worktree') {
      incoming.mobileSessionTabs![0].worktreeInstanceId = 'replacement'
    }
    if (reason === 'replacement-surface') {
      surface.id = 'replacement-surface'
    }
    runtime.syncWindowGraph(1, incoming)
    const accepted = runtime.snapshot()?.tabs.find((tab) => tab.id === surface.id)
    expect(accepted?.type === 'terminal' ? accepted.incarnationId : undefined).not.toBe(INCARNATION)
    runtime.syncWindowGraph(1, graph(null, 4, true))
    expect(runtime.binding()).toBeNull()
  })

  it.each([false, true])(
    'keeps the native owner when renderer publications omit incarnation (emptyGraph=%s)',
    async (emptyGraph) => {
      const { runtime, write } = setup(false, true)
      const [before] = (await runtime.listTerminals()).terminals
      const incoming = graph(null, 2, true)
      runtime.syncWindowGraph(1, emptyGraph ? { ...incoming, tabs: [], leaves: [] } : incoming)
      expect((await runtime.listTerminals()).terminals).toMatchObject([
        {
          handle: before.handle,
          tabId: TAB,
          leafId: LEAF,
          ptyId: PTY,
          incarnationId: INCARNATION,
          orphaned: false
        }
      ])
      await runtime.sendTerminal(
        before.handle,
        { text: 'original native owner' },
        { inputKind: 'driving' }
      )
      expect(write).toHaveBeenCalledWith(PTY, 'original native owner', 'driving')
      runtime.syncWindowGraph(1, graph(null, 3, true))
      expect(runtime.binding()).toBe(PTY)
      expect((await runtime.listTerminals()).terminals).toMatchObject([{ handle: before.handle }])
    }
  )

  it.each([false, true])(
    'retains an unmounted bound publication handle (unchanged=%s)',
    async (unchanged) => {
      const { runtime, write } = setup()
      const [before] = (await runtime.listTerminals()).terminals
      const incoming: RuntimeRendererSyncWindowGraph = {
        ...graph(PTY, 2),
        tabs: [],
        leaves: [],
        rendererGeneration: 'renderer',
        ...(unchanged ? { mobileSessionTabs: [], unchangedMobileSessionWorktrees: [WORKTREE] } : {})
      }
      runtime.syncWindowGraph(1, incoming)
      expect(runtime.binding()).toBeUndefined()
      expect((await runtime.listTerminals()).terminals).toMatchObject([
        { handle: before.handle, tabId: TAB, leafId: LEAF, ptyId: PTY, orphaned: false }
      ])
      await runtime.sendTerminal(before.handle, { text: 'parked owner' }, { inputKind: 'driving' })
      expect(write).toHaveBeenCalledWith(PTY, 'parked owner', 'driving')
      runtime.syncWindowGraph(1, graph(PTY, 3))
      expect((await runtime.listTerminals()).terminals).toMatchObject([{ handle: before.handle }])
    }
  )

  it.each([false, true])(
    'keeps a published owner through an empty graph (unmounted=%s)',
    async (unmounted) => {
      const { runtime, write } = setup(unmounted)
      const [before] = (await runtime.listTerminals()).terminals
      runtime.syncWindowGraph(1, { ...graph(null, 2), tabs: [], leaves: [] })
      expect(runtime.binding()).toBeUndefined()
      expect(runtime.snapshot()?.tabs).toMatchObject([
        { parentTabId: TAB, leafId: LEAF, ptyId: PTY, incarnationId: INCARNATION }
      ])
      expect((await runtime.listTerminals()).terminals).toMatchObject([
        { handle: before.handle, tabId: TAB, leafId: LEAF, ptyId: PTY, orphaned: false }
      ])
      runtime.syncWindowGraph(1, graph(null, 3))
      expect(runtime.binding()).toBe(PTY)
      expect((await runtime.listTerminals()).terminals).toHaveLength(1)
      expect((await runtime.listTerminals()).terminals).toMatchObject([
        { handle: before.handle, tabId: TAB, leafId: LEAF, ptyId: PTY, incarnationId: INCARNATION }
      ])
      await runtime.sendTerminal(
        before.handle,
        { text: 'unmounted owner' },
        { inputKind: 'driving' }
      )
      expect(write).toHaveBeenCalledWith(PTY, 'unmounted owner', 'driving')
    }
  )

  it.each([
    'renderer-owned',
    'unverifiable',
    'stopping',
    'replacement-incarnation',
    'removed-publication',
    'competing-layout',
    'competing-graph',
    'replacement-worktree'
  ])('refuses an unmounted publication without retained host authority (%s)', async (reason) => {
    const { runtime } = setup()
    const [before] = (await runtime.listTerminals()).terminals
    const incoming: RuntimeSyncWindowGraph = { ...graph(null, 2), tabs: [], leaves: [] }
    if (reason === 'renderer-owned') {
      runtime.setRuntimeOwned(false)
    }
    if (reason === 'unverifiable') {
      runtime.markPtyLivenessUnverifiable(PTY, 'Host unavailable')
    }
    if (reason === 'stopping') {
      runtime.markPtyStopRequested(PTY)
    }
    if (reason === 'replacement-incarnation') {
      runtime.registerPty(PTY, WORKTREE, null, {
        tabId: TAB,
        leafId: LEAF,
        incarnationId: 'replacement'
      })
    }
    if (reason === 'removed-publication') {
      incoming.mobileSessionTabs![0].tabs = []
    }
    if (reason === 'replacement-worktree') {
      incoming.mobileSessionTabs![0].worktreeInstanceId = 'replacement'
    }
    if (reason === 'competing-layout') {
      const surface = incoming.mobileSessionTabs![0].tabs[0]
      if (surface.type !== 'terminal') {
        throw new Error('Missing terminal fixture')
      }
      surface.parentLayout!.ptyIdsByLeafId = { [OTHER_LEAF]: PTY }
    }
    if (reason === 'competing-graph') {
      incoming.leaves.push({
        tabId: TAB,
        worktreeId: WORKTREE,
        leafId: OTHER_LEAF,
        paneRuntimeId: 2,
        ptyId: PTY
      })
    }
    runtime.syncWindowGraph(1, incoming)
    expect(runtime.binding()).toBeUndefined()
    if (reason === 'removed-publication') {
      await expect(runtime.readTerminal(before.handle)).rejects.toThrow('terminal_handle_stale')
    } else {
      const surface = runtime.snapshot()?.tabs.find((tab) => tab.id === `${TAB}::${LEAF}`)
      expect(surface?.type === 'terminal' ? surface.ptyId : undefined).not.toBe(PTY)
    }
  })

  it('keeps the published host identity on the first renderer mount before any prior graph leaf', async () => {
    const runtime = new RuntimeFixture(null)
    const write = vi.fn(() => true)
    runtime.setPtyController({ write, kill: () => true, getForegroundProcess: async () => null })
    runtime.attachWindow(1)
    runtime.registerPty(PTY, WORKTREE, null, {
      tabId: TAB,
      leafId: LEAF,
      incarnationId: INCARNATION
    })
    runtime.setRuntimeOwned(true)
    runtime.syncWindowGraph(1, { ...graph(PTY, 1), tabs: [], leaves: [] })
    const [before] = (await runtime.listTerminals()).terminals
    runtime.syncWindowGraph(1, graph(null, 2))
    expect(runtime.binding()).toBe(PTY)
    const after = (await runtime.listTerminals()).terminals
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({
      handle: before.handle,
      tabId: TAB,
      leafId: LEAF,
      ptyId: PTY,
      incarnationId: INCARNATION
    })
    await runtime.sendTerminal(before.handle, { text: 'first owner' }, { inputKind: 'driving' })
    expect(write).toHaveBeenCalledWith(PTY, 'first owner', 'driving')
  })

  it('retains the original handle when a null pane uses an acknowledged unchanged publication', async () => {
    const { runtime, write } = setup()
    const [before] = (await runtime.listTerminals()).terminals
    const incoming: RuntimeRendererSyncWindowGraph = {
      ...graph(null, 2),
      rendererGeneration: 'renderer',
      mobileSessionTabs: [],
      unchangedMobileSessionWorktrees: [WORKTREE]
    }
    runtime.syncWindowGraph(1, incoming)
    expect(runtime.binding()).toBe(PTY)
    expect((await runtime.listTerminals()).terminals).toMatchObject([
      { handle: before.handle, tabId: TAB, leafId: LEAF, ptyId: PTY, incarnationId: INCARNATION }
    ])
    await runtime.sendTerminal(before.handle, { text: 'unchanged owner' }, { inputKind: 'driving' })
    expect(write).toHaveBeenCalledWith(PTY, 'unchanged owner', 'driving')
  })

  it.each(['undeclared', 'unaccepted', 'different-generation', 'no-publication-partition'])(
    'refuses missing mobile publication without current renderer acknowledgement (%s)',
    (reason) => {
      const { runtime } = setup()
      if (reason === 'unaccepted') {
        runtime.forgetRendererPublication()
      }
      const incoming: RuntimeRendererSyncWindowGraph = {
        ...graph(null, 2),
        rendererGeneration: reason === 'different-generation' ? 'other-renderer' : 'renderer',
        mobileSessionTabs: reason === 'no-publication-partition' ? undefined : [],
        unchangedMobileSessionWorktrees: reason === 'undeclared' ? [] : [WORKTREE]
      }
      runtime.syncWindowGraph(1, incoming)
      expect(runtime.binding()).toBeNull()
    }
  )

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
