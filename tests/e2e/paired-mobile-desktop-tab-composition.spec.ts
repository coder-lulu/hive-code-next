/** A phone and desktop compose the same owning Runtime's tabs. No desktop-to-host delegation. */
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { pairMobileClient, type PairedMobileClient } from './helpers/paired-mobile-client'
import {
  createDesktopMobilePairingOffer,
  createRuntimeDesktopPairingOffer
} from './helpers/paired-electron-client'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { readPublishedLayout } from './helpers/layout-compat-baseline'
import { z } from 'zod'
import { decodePairingOffer } from '../../src/shared/pairing'
import { sendRemoteRuntimeRequest } from '../../src/shared/remote-runtime-client'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'
const CreatedTerminalSchema = z.looseObject({
  tab: z.looseObject({ parentTabId: z.string() })
})
const SessionTabsSchema = z.looseObject({
  activeTabId: z.string().nullable(),
  tabGroups: z.array(z.looseObject({ id: z.string(), tabOrder: z.array(z.string()) })).optional(),
  tabs: z.array(
    z.looseObject({ id: z.string(), type: z.string(), parentTabId: z.string().optional() })
  )
})

async function call<T>(
  phone: PairedMobileClient,
  method: string,
  params: unknown,
  schema: z.ZodType<T>
): Promise<T> {
  return schema.parse(await phone.call(method, params))
}

/** Each tab group's tab order. Group ids are each host's own, so only order and membership compare. */
type Strip = string[][]

/** The desktop's tab groups for a workspace, each tab named by the server tab it mirrors. */
async function desktopStrip(page: Page, worktreeId: string): Promise<Strip> {
  const groups = await page.evaluate(
    (id) => (window.__store?.getState().groupsByWorktree[id] ?? []).map((group) => group.tabOrder),
    worktreeId
  )
  return groups
}

function desktopActiveTab(page: Page, worktreeId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const state = window.__store?.getState()
    const activeGroupId = state?.activeGroupIdByWorktree[id]
    return (
      state?.groupsByWorktree[id]?.find((group) => group.id === activeGroupId)?.activeTabId ?? null
    )
  }, worktreeId)
}

function desktopTab(page: Page, hostTabId: string) {
  return page.locator(`${SORTABLE_TAB}[data-tab-id="${hostTabId}"]`)
}

/** Drops one desktop tab onto the leading edge of another, as a user drags in the tab strip. */
async function dragTab(page: Page, hostTabId: string, ontoHostTabId: string): Promise<void> {
  const from = (await desktopTab(page, hostTabId).boundingBox())!
  const onto = (await desktopTab(page, ontoHostTabId).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(onto.x + onto.width * 0.25, onto.y + onto.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('phone and desktop share one Runtime tab strip with independent selection', async ({
  orcaPage: page,
  electronApp
}) => {
  test.setTimeout(240_000)
  await waitForSessionReady(page)
  const worktreeId = await waitForActiveWorktree(page)
  const desktop = { page, app: electronApp }
  const desktopWorktree = { id: worktreeId }
  const serverWorktreeId = worktreeId
  const offer = await createRuntimeDesktopPairingOffer(page)
  const phone = pairMobileClient(await createDesktopMobilePairingOffer(page))
  try {
    await page.evaluate((id) => {
      const state = window.__store!.getState()
      for (const tab of state.tabsByWorktree[id] ?? []) {
        state.closeTab(tab.id)
      }
    }, worktreeId)
    const worktree = `id:${worktreeId}`
    const phoneTabs = () => call(phone, 'session.tabs.list', { worktree }, SessionTabsSchema)
    const created: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const { tab } = await call(
        phone,
        'session.tabs.createTerminal',
        { worktree, activate: false, select: false, navigation: 'caller' },
        CreatedTerminalSchema
      )
      created.push(tab.parentTabId)
    }

    await desktop.page.evaluate(
      (id) => window.__store?.getState().setActiveWorktree(id),
      desktopWorktree.id
    )
    await expect.poll(() => desktop.page.locator(SORTABLE_TAB).count(), { timeout: 30_000 }).toBe(3)

    // A server-placed browser page sits in the same strip.
    await call(
      phone,
      'browser.tabCreate',
      { worktree, url: 'about:blank', activate: false },
      z.looseObject({})
    )
    const phoneStrip = async (): Promise<Strip> =>
      ((await phoneTabs()).tabGroups ?? []).map((group) => group.tabOrder)
    await expect
      .poll(async () => (await desktopStrip(desktop.page, desktopWorktree.id))[0]?.length, {
        timeout: 30_000
      })
      .toBe(4)
    const [first, second, third] = created
    // The server's own strip, read on the server: its tab list and its published layout.
    const serverStrip = async (): Promise<Strip> => {
      const response = await sendRemoteRuntimeRequest(
        decodePairingOffer(offer.pairingUrl),
        'session.tabs.list',
        { worktree },
        30_000
      )
      if (!response.ok) {
        throw new Error(response.error.message)
      }
      return (SessionTabsSchema.parse(response.result).tabGroups ?? []).map(
        (group) => group.tabOrder
      )
    }
    const publishedStrip = async (): Promise<Strip> =>
      (await readPublishedLayout(offer.pairingUrl, serverWorktreeId))?.groups.map(
        (group) => group.tabIds
      ) ?? []

    // Reorder on the desktop by dragging the third terminal onto the first.
    await dragTab(desktop.page, third, first)
    await expect
      .poll(async () => (await desktopStrip(desktop.page, desktopWorktree.id))[0]?.slice(0, 3))
      .toEqual([third, first, second])

    // Group on the desktop: move the second terminal into a split of its own.
    await desktopTab(desktop.page, second).click({ button: 'right' })
    await desktop.page.getByRole('menuitem', { name: 'Move Tab to Split' }).hover()
    await desktop.page.getByRole('menuitem', { name: 'Right', exact: true }).click()
    await expect
      .poll(async () => (await desktopStrip(desktop.page, desktopWorktree.id)).length)
      .toBe(2)
    const splitOff = await desktopStrip(desktop.page, desktopWorktree.id)
    await expect.poll(phoneStrip, { timeout: 30_000 }).toEqual(splitOff)
    expect(await serverStrip()).toEqual(splitOff)

    // Drag the first terminal into the group the desktop just split off.
    await dragTab(desktop.page, first, second)
    await expect
      .poll(async () =>
        (await desktopStrip(desktop.page, desktopWorktree.id)).find((group) =>
          group.includes(second)
        )
      )
      .toContain(first)
    const arranged = await desktopStrip(desktop.page, desktopWorktree.id)
    await expect.poll(phoneStrip, { timeout: 30_000 }).toEqual(arranged)
    expect(await serverStrip()).toEqual(arranged)
    const browserTabIds = new Set(
      (await phoneTabs()).tabs.filter((tab) => tab.type === 'browser').map((tab) => tab.id)
    )
    expect(browserTabIds.size).toBe(1)
    expect(await publishedStrip()).toEqual(arranged)
    // A phone token authorizes this Runtime only; removed desktop delegation is unavailable.
    const delegated = await phone.request('mobileRelay.hosts.worktrees', {
      hostId: 'runtime:unrelated-host'
    })
    expect(delegated.ok).toBe(false)

    // Selection is each device's own, as for a local workspace.
    await call(
      phone,
      'session.tabs.activate',
      { worktree, tabId: first, navigation: 'caller' },
      z.looseObject({})
    )
    await desktopTab(desktop.page, third).click()
    await expect.poll(() => desktopActiveTab(desktop.page, desktopWorktree.id)).toBe(third)
    const phoneActive = async () => {
      const { activeTabId, tabs } = await phoneTabs()
      return tabs.find((candidate) => candidate.id === activeTabId)?.parentTabId
    }
    expect(await phoneActive()).toBe(first)

    // With the desktop window closed, the phone still reads the server's strip. Only macOS keeps
    // the app running without a window (window-all-closed-quit-policy.ts).
    if (process.platform !== 'darwin') {
      return
    }
    await desktop.app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.close()
      }
    })
    await expect
      .poll(() => desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(0)
    expect(await phoneStrip()).toEqual(arranged)
    expect(await serverStrip()).toEqual(arranged)
    expect(await phoneActive()).toBe(first)
  } finally {
    phone.dispose()
  }
})
