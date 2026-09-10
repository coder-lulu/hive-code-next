import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import type { AgentSessionHistoryPage } from '../../src/shared/agent-session-wire'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'

test.use({ minimumSeededWorktreeCount: 1 })

const SESSION_ID = 'p2-structured-runtime-session'
const TAB_ID = 'p2-structured-tab'
const TITLE = 'P2 Structured approval and draft'
const MESSAGE = 'This conversation stays resident while its destination changes.'

type FixtureStats = {
  calls: { method: string; params?: Record<string, unknown> }[]
  subscriptionCount: number
  activeSubscriptions: number
  activeHolds: number
  maxSubscriptions: number
  maxHolds: number
}

function journalPage(): AgentSessionHistoryPage {
  const cursor = { epoch: 'p2-journal-epoch', sequence: 3 }
  const observedAt = Date.now()
  return {
    sessionId: SESSION_ID,
    epoch: cursor.epoch,
    fence: 7,
    direction: 'tail',
    items: [
      {
        itemId: 'user-1',
        revision: 1,
        sequence: 1,
        observedAt: observedAt - 3000,
        body: {
          kind: 'message',
          role: 'user',
          blocks: [{ type: 'text', text: 'Review this session navigation change.' }]
        }
      },
      {
        itemId: 'assistant-1',
        revision: 1,
        sequence: 2,
        observedAt: observedAt - 2000,
        body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: MESSAGE }] }
      },
      {
        itemId: 'approval-1',
        revision: 1,
        sequence: 3,
        observedAt: observedAt - 1000,
        body: {
          kind: 'approval',
          title: 'Allow the fixture review operation?',
          detail: 'No external command is executed by this test.',
          options: [
            { id: 'allow-once', label: 'Allow once' },
            { id: 'deny', label: 'Deny' }
          ],
          resolution: {
            state: 'pending',
            selectedOptionId: null,
            resolvedBy: null,
            resolvedAt: null
          }
        }
      }
    ],
    removedItemIds: [],
    submissions: [],
    window: { oldest: { ...cursor, sequence: 1 }, newest: cursor, nextCursor: cursor },
    liveCursor: cursor,
    hasOlder: false,
    hasNewer: false
  }
}

async function installJournalFixture(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, page) => {
    if (!('_invokeHandlers' in ipcMain) || !(ipcMain._invokeHandlers instanceof Map)) {
      throw new Error('Electron invoke handlers unavailable')
    }
    const originalCall = ipcMain._invokeHandlers.get('runtime:call')
    const originalSubscribe = ipcMain._invokeHandlers.get('runtime:subscribe')
    if (typeof originalCall !== 'function' || typeof originalSubscribe !== 'function') {
      throw new Error('Runtime IPC handlers unavailable')
    }
    const calls: FixtureStats['calls'] = []
    const subscriptions = new Map<string, Electron.WebContents>()
    const holders = new Set<string>()
    let subscriptionCount = 0
    let maxSubscriptions = 0
    let maxHolds = 0
    const publish = (result: unknown): void => {
      for (const [id, sender] of subscriptions) {
        if (!sender.isDestroyed()) {
          sender.send(`runtime:subscription:${id}`, { id, ok: true, result, streaming: true })
        }
      }
    }
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle(
      'runtime:call',
      async (event, args: { method: string; params?: Record<string, unknown> }) => {
        const params = args.params ?? {}
        const envelope = params.envelope as { sessionId?: string } | undefined
        const fixtureCall =
          params.sessionId === page.sessionId ||
          envelope?.sessionId === page.sessionId ||
          (args.method === 'session.tabs.activate' &&
            params.tabId === `agent-session:${page.sessionId}`)
        if (!fixtureCall) {
          return originalCall(event, args)
        }
        calls.push(args)
        const reply = (result: unknown) => ({ id: 'desktop-ipc', ok: true, result })
        switch (args.method) {
          case 'agentSession.hold':
            holders.add(String(params.holderId))
            maxHolds = Math.max(maxHolds, holders.size)
            return reply({ held: true })
          case 'agentSession.release':
            holders.delete(String(params.holderId))
            return reply({ released: true })
          case 'agentSession.history':
            return reply({ ok: true, page })
          case 'agentSession.options':
            return reply({
              models: [],
              current: { model: 'gpt-fixture' },
              conversationCommands: []
            })
          case 'agentSession.commands':
            return reply({ commands: [] })
          case 'session.tabs.activate':
            return reply({ activated: true })
          case 'agentSession.respondToApproval': {
            const item = page.items.find((entry) => entry.itemId === params.itemId)
            if (!item || item.body.kind !== 'approval') {
              throw new Error('Unexpected fixture prompt')
            }
            const resolution = {
              state: 'resolved' as const,
              selectedOptionId: String(params.optionId),
              resolvedBy: 'e2e-desktop',
              resolvedAt: Date.now()
            }
            item.revision += 1
            item.body = { ...item.body, resolution }
            page.liveCursor = { epoch: page.epoch, sequence: 4 }
            publish({
              type: 'batch',
              sessionId: page.sessionId,
              fence: 7,
              batch: { cursor: page.liveCursor, items: [item], removedItemIds: [], submissions: [] }
            })
            return reply({
              ok: true,
              replayed: false,
              fence: 7,
              cursor: page.liveCursor,
              value: { itemId: item.itemId, revision: item.revision, resolution }
            })
          }
          default:
            throw new Error(`Unexpected fixture RPC ${args.method}`)
        }
      }
    )
    ipcMain.removeHandler('runtime:subscribe')
    ipcMain.handle(
      'runtime:subscribe',
      (
        event,
        args: { subscriptionId: string; method: string; params?: { sessionId?: string } }
      ) => {
        if (args.method !== 'agentSession.subscribe' || args.params?.sessionId !== page.sessionId) {
          return originalSubscribe(event, args)
        }
        subscriptions.set(args.subscriptionId, event.sender)
        subscriptionCount += 1
        maxSubscriptions = Math.max(maxSubscriptions, subscriptions.size)
        event.sender.send(`runtime:subscription:${args.subscriptionId}`, {
          id: args.subscriptionId,
          ok: true,
          streaming: true,
          result: { type: 'snapshot', sessionId: page.sessionId, page, fence: 7, commands: [] }
        })
        return { subscribed: true }
      }
    )
    const unsubscribe = (_event: Electron.IpcMainEvent, args: { subscriptionId: string }): void => {
      subscriptions.delete(args.subscriptionId)
    }
    ipcMain.on('runtime:unsubscribe', unsubscribe)
    Reflect.set(globalThis, '__p2StructuredFixture', {
      stats: () => ({
        calls,
        subscriptionCount,
        activeSubscriptions: subscriptions.size,
        activeHolds: holders.size,
        maxSubscriptions,
        maxHolds
      }),
      restore: () => {
        ipcMain.removeHandler('runtime:call')
        ipcMain.removeHandler('runtime:subscribe')
        ipcMain.handle('runtime:call', originalCall)
        ipcMain.handle('runtime:subscribe', originalSubscribe)
        ipcMain.removeListener('runtime:unsubscribe', unsubscribe)
        subscriptions.clear()
        holders.clear()
      }
    })
  }, journalPage())
}

async function stats(electronApp: ElectronApplication): Promise<FixtureStats> {
  return electronApp.evaluate(() => Reflect.get(globalThis, '__p2StructuredFixture').stats())
}

async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env.HIVE_UI_BASELINE_DIR
  if (!directory) {
    return
  }
  mkdirSync(directory, { recursive: true })
  const dismiss = page.getByRole('button', { name: 'Dismiss setup scripts', exact: true })
  if (await dismiss.isVisible()) {
    await dismiss.click()
  }
  await page.mouse.move(550, 400)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  const metrics = await page.evaluate(() => ({
    theme: document.documentElement.className,
    viewport: { width: innerWidth, height: innerHeight },
    anchor: document
      .querySelector('[data-testid="session-chat-anchor"]')
      ?.getBoundingClientRect()
      .toJSON(),
    overlay: document
      .querySelector('[data-structured-agent-session-overlay-tab-id="p2-structured-tab"]')
      ?.getBoundingClientRect()
      .toJSON(),
    composer: document
      .querySelector(
        '[data-structured-agent-session-overlay-tab-id="p2-structured-tab"] [role="textbox"]'
      )
      ?.getBoundingClientRect()
      .toJSON()
  }))
  writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(metrics, null, 2))
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled' })
}

test('keeps the real structured chat, approval routing and draft resident between session center and workspace', async ({
  electronApp,
  orcaPage: page
}) => {
  test.setTimeout(180_000)
  await waitForSessionReady(page)
  await ensureTerminalVisible(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await installJournalFixture(electronApp)
  try {
    await page.evaluate(
      async ({ sessionId, tabId, title }) => {
        const store = window.__store!
        await store.getState().updateSettings({ theme: 'light' })
        const state = store.getState()
        const worktreeId = state.activeWorktreeId!
        const group = state.groupsByWorktree[worktreeId][0]
        const tab = {
          id: tabId,
          worktreeId,
          executionHostId: 'local' as const,
          groupId: group.id,
          contentType: 'agent-session' as const,
          agentSessionAgent: 'codex',
          entityId: sessionId,
          label: title,
          customLabel: null,
          color: null,
          sortOrder: 1,
          createdAt: Date.now()
        }
        store.setState({
          sidebarOpen: true,
          sidebarWidth: 240,
          rightSidebarOpen: false,
          unifiedTabsByWorktree: {
            ...state.unifiedTabsByWorktree,
            [worktreeId]: [...state.unifiedTabsByWorktree[worktreeId], tab]
          },
          groupsByWorktree: {
            ...state.groupsByWorktree,
            [worktreeId]: state.groupsByWorktree[worktreeId].map((entry) =>
              entry.id === group.id ? { ...entry, tabOrder: [...entry.tabOrder, tabId] } : entry
            )
          }
        })
      },
      { sessionId: SESSION_ID, tabId: TAB_ID, title: TITLE }
    )
    const nav = page
      .locator('.sidebar-primary-nav')
      .getByRole('button', { name: 'Sessions', exact: true })
    await nav.click()
    await page.getByTestId('session-center-row').filter({ hasText: TITLE }).click()
    const overlay = page.locator(`[data-structured-agent-session-overlay-tab-id="${TAB_ID}"]`)
    const chat = overlay.locator('[data-native-chat-root="true"]')
    await expect(chat).toBeVisible()
    await expect(chat.getByText(MESSAGE, { exact: true })).toBeVisible()
    const allow = chat.getByRole('button', { name: 'Allow once', exact: true })
    await expect(allow).toBeVisible()
    await expect(
      page.locator(`[data-structured-agent-session-overlay-tab-id="${TAB_ID}"]`)
    ).toHaveCount(1)
    const residentChat = await chat.elementHandle()
    const composer = chat.getByRole('textbox')
    await capture(page, 'p2-structured-01-light-approval')
    const geometry = await overlay.evaluate((element) => {
      const anchor = document
        .querySelector('[data-testid="session-chat-anchor"]')!
        .getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      return [
        Math.abs(rect.x - anchor.x),
        Math.abs(rect.y - anchor.y),
        Math.abs(rect.width - anchor.width),
        Math.abs(rect.height - anchor.height)
      ]
    })
    expect(geometry.every((difference) => difference <= 1)).toBe(true)
    await allow.click()
    await expect(allow).toHaveCount(0)
    const residentComposer = await composer.elementHandle()
    const response = (await stats(electronApp)).calls.find(
      (call) => call.method === 'agentSession.respondToApproval'
    )
    expect(response?.params).toMatchObject({
      envelope: { sessionId: SESSION_ID, expectedRuntimeFence: 7 },
      itemId: 'approval-1',
      expectedRevision: 1,
      optionId: 'allow-once'
    })
    await composer.fill('P2 preserved draft 中文输入')
    await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
    await expect(page.locator('html')).toHaveClass(/dark/)
    await capture(page, 'p2-structured-02-dark-draft')
    await page.getByRole('button', { name: 'Close session view', exact: true }).click()
    await expect(page.getByTestId('sessions-page')).toBeVisible()
    await expect(chat).not.toBeVisible()
    await page.getByTestId('session-center-row').filter({ hasText: TITLE }).click()
    await expect(chat).toBeVisible()
    await expect(composer).toHaveText('P2 preserved draft 中文输入')
    await expect(page.locator('.terminal-tab-strip').first().locator('[data-tab-id]')).toHaveCount(
      2
    )
    await expect(page.locator('.xterm')).toHaveCount(1)
    expect(await residentChat!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await residentComposer!.evaluate((element) => element.isConnected)).toBe(true)
    await nav.click()
    await expect(chat).toBeVisible()
    await expect(composer).toHaveText('P2 preserved draft 中文输入')
    await expect(overlay).toHaveCount(1)
    expect(await residentChat!.evaluate((element) => element.isConnected)).toBe(true)
    expect(await residentComposer!.evaluate((element) => element.isConnected)).toBe(true)
    await page.setViewportSize({ width: 900, height: 760 })
    await expect(
      page.getByRole('button', { name: 'Back to session list', exact: true })
    ).toBeVisible()
    await expect(composer).toBeVisible()
    await capture(page, 'p2-structured-03-narrow-return')
    const evidence = await stats(electronApp)
    expect(evidence.calls.filter((call) => call.method === 'agentSession.hold')).toHaveLength(2)
    expect(evidence).toMatchObject({
      subscriptionCount: 2,
      activeSubscriptions: 1,
      activeHolds: 1,
      maxSubscriptions: 1,
      maxHolds: 1
    })
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
  } finally {
    await electronApp.evaluate(() => {
      Reflect.get(globalThis, '__p2StructuredFixture')?.restore()
      Reflect.deleteProperty(globalThis, '__p2StructuredFixture')
    })
  }
})
