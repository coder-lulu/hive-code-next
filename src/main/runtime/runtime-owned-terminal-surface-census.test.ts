import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService, getDefaultWorkspaceSession } from './orca-runtime-test-mocks.spec'
import type { RuntimePtyController } from './runtime-pty-controller-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import {
  HEADLESS_LEAF_ID,
  TEST_REPO_ID,
  TEST_WORKTREE_ID,
  TEST_WORKTREE_PATH,
  makeRuntimeStoreWithWorkspaceSession
} from './orca-runtime-test-fixtures.spec'

describe('runtime-owned terminal surface census', () => {
  it('preserves a background Hive pane across renderer omissions and releases it on close', async () => {
    const ptyId = `${TEST_WORKTREE_ID}@@hive-background`
    let alive = true
    const { runtimeStore } = makeRuntimeStoreWithWorkspaceSession({
      ...getDefaultWorkspaceSession(),
      activeRepoId: TEST_REPO_ID,
      activeWorktreeId: TEST_WORKTREE_ID,
      tabsByWorktree: {
        [TEST_WORKTREE_ID]: [
          {
            id: 'hive-background-tab',
            ptyId: null,
            worktreeId: TEST_WORKTREE_ID,
            title: 'Pi',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 1
          }
        ]
      }
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: shared fixture implements the session and repo store operations exercised here.
    const runtime = new OrcaRuntimeService(runtimeStore as never)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: exposes the existing protected selector solely to isolate Git discovery in this test.
    const selector = runtime as unknown as {
      resolveWorktreeSelector: (value: string) => Promise<ResolvedWorktree>
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the census uses only this fixture's workspace identity and path.
    vi.spyOn(selector, 'resolveWorktreeSelector').mockResolvedValue({
      id: TEST_WORKTREE_ID,
      path: TEST_WORKTREE_PATH,
      repoId: TEST_REPO_ID,
      branch: 'main'
    } as never)
    runtime.setPtyController({
      spawn: vi.fn(async (args: Parameters<NonNullable<RuntimePtyController['spawn']>>[0]) => {
        if (args.persistHostSessionBinding) {
          await runtimeStore.persistPtyBinding({
            worktreeId: args.worktreeId!,
            tabId: args.tabId!,
            leafId: args.leafId!,
            ptyId
          })
        }
        return { id: ptyId, incarnationId: 'hive-incarnation' }
      }),
      write: () => true,
      kill: () => {
        alive = false
        return true
      },
      getForegroundProcess: async () => null,
      listProcesses: async () =>
        alive
          ? [
              {
                id: ptyId,
                incarnationId: 'hive-incarnation',
                cwd: TEST_WORKTREE_PATH,
                worktreeId: TEST_WORKTREE_ID,
                title: 'Pi'
              }
            ]
          : []
    })
    runtime.attachWindow(1)
    const omit = (snapshotVersion: number): void => {
      runtime.syncWindowGraph(1, {
        tabs: [],
        leaves: [],
        mobileSessionTabs: [
          {
            worktree: TEST_WORKTREE_ID,
            publicationEpoch: 'renderer:hive-background',
            snapshotVersion,
            activeGroupId: null,
            activeTabId: null,
            activeTabType: null,
            tabs: []
          }
        ]
      })
    }
    omit(1)
    const created = await runtime.createTerminal(`id:${TEST_WORKTREE_ID}`, {
      presentation: 'background',
      tabId: 'hive-background-tab',
      leafId: HEADLESS_LEAF_ID,
      launchAgent: 'pi'
    })
    expect(runtimeStore.persistPtyBinding).toHaveBeenCalledWith({
      worktreeId: TEST_WORKTREE_ID,
      tabId: 'hive-background-tab',
      leafId: HEADLESS_LEAF_ID,
      ptyId
    })
    omit(2)
    omit(3)
    expect((await runtime.listMobileSessionTabs(`id:${TEST_WORKTREE_ID}`)).tabs).toEqual([
      expect.objectContaining({ parentTabId: created.tabId, launchAgent: 'pi' })
    ])
    const listed = await runtime.listTerminals(`id:${TEST_WORKTREE_ID}`, undefined, {
      includeVisualLayouts: false
    })
    expect(listed.terminals).toEqual([
      expect.objectContaining({
        ptyId,
        tabId: created.tabId,
        leafId: HEADLESS_LEAF_ID,
        launchAgent: 'pi',
        orphaned: false
      })
    ])
    expect(created.tabId).toBe('hive-background-tab')
    await runtime.closeMobileSessionTab(`id:${TEST_WORKTREE_ID}`, 'hive-background-tab', {
      reason: 'user'
    })
    omit(4)
    expect((await runtime.listMobileSessionTabs(`id:${TEST_WORKTREE_ID}`)).tabs).toEqual([])
    expect((await runtime.listTerminals(`id:${TEST_WORKTREE_ID}`)).terminals).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tabId: created.tabId, orphaned: false })])
    )
  })
})
