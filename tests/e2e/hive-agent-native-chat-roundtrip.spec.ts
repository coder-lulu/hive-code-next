import { createServer } from 'node:http'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { getPiAgentStatusExtensionSource } from '../../src/main/pi/agent-status-extension-source'
import { getPiPrefillExtensionSource } from '../../src/main/pi/prefill-extension-source'
import { getPiTitlebarExtensionSource } from '../../src/main/pi/titlebar-extension-source'
import type { HiveAiCatalogModel } from '../../src/shared/hive-ai-model-catalog'

const fixtureModel = {
  modelId: 'fixture-model',
  protocols: ['CHAT_COMPLETIONS'],
  contextWindow: 32768,
  maxOutputTokens: 4096
} satisfies HiveAiCatalogModel

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('Hive native Pi repairs code with native read, bash and edit tools and displays the reply and model in Orca Chat UI', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  expect(userData).toContain('orca-e2e-userdata-')
  const agentDirectory = testInfo.outputPath('account-agent')
  const extensions = join(agentDirectory, 'extensions')
  const sample = testInfo.outputPath('sample.mjs')
  const sampleTest = testInfo.outputPath('sample.test.mjs')
  const slowScript = testInfo.outputPath('slow.mjs')
  const slowStarted = testInfo.outputPath('slow-started.json')
  const slowFinished = testInfo.outputPath('slow-finished.txt')
  await mkdir(testInfo.outputPath(), { recursive: true })
  await writeFile(
    slowScript,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(slowStarted)}, JSON.stringify({pid: process.pid})); setTimeout(() => writeFileSync(${JSON.stringify(slowFinished)}, 'finished'), 30000);`
  )
  const originalSource = 'export const add = (a, b) => a - b; // native-chat-read-tool-proof\n'
  const repairedSource = originalSource.replace('a - b', 'a + b')
  const testCommand = `"${process.execPath.replaceAll('\\', '/')}" "${sampleTest.replaceAll('\\', '/')}"`
  await mkdir(extensions, { recursive: true })
  await writeFile(sample, originalSource)
  await writeFile(
    sampleTest,
    "import assert from 'node:assert/strict'; import { add } from './sample.mjs'; assert.equal(add(2, 3), 5); console.log('NATIVE_CODING_TEST_PASS');\n"
  )
  await Promise.all([
    writeFile(join(extensions, 'orca-agent-status.ts'), getPiAgentStatusExtensionSource('pi')),
    writeFile(join(extensions, 'orca-prefill.ts'), getPiPrefillExtensionSource('pi')),
    writeFile(join(extensions, 'orca-titlebar-spinner.ts'), getPiTitlebarExtensionSource('pi'))
  ])
  const bootstrap = 'a'.repeat(43)
  const lease = 'b'.repeat(43)
  const requests: {
    tools?: { function?: { name?: string } }[]
    messages?: { role?: string; content?: unknown }[]
  }[] = []
  const fixtureErrors: string[] = []
  const fixturePaths: string[] = []
  let baseUrl = ''
  const server = createServer(async (request, response) => {
    try {
      fixturePaths.push(`${request.method} ${request.url}`)
      const expected = request.url === '/launch' ? bootstrap : lease
      if (request.headers.authorization !== `Bearer ${expected}`) {
        response.writeHead(401).end()
        fixtureErrors.push('missing fixture authentication')
        return
      }
      if (request.url === '/launch') {
        response.setHeader('Content-Type', 'application/json')
        response.end(
          JSON.stringify({
            token: lease,
            baseUrl: `${baseUrl}/v1`,
            runtimeDirectory: resolve(`out/native-pi/${process.platform}-${process.arch}`),
            agentDirectory,
            models: [fixtureModel],
            selection: null
          })
        )
        return
      }
      if (request.url === '/lease') {
        response.setHeader('Content-Type', 'application/json')
        response.end('{}')
        return
      }
      if (request.url !== '/v1/chat/completions') {
        fixtureErrors.push(`unexpected fixture path: ${request.url}`)
        response.writeHead(404).end()
        return
      }
      let body = ''
      for await (const chunk of request) {
        body += chunk
      }
      requests.push(JSON.parse(body))
      const steps = [
        { name: 'read', args: { path: sample } },
        { name: 'bash', args: { command: testCommand, timeout: 15 } },
        { name: 'edit', args: { path: sample, edits: [{ oldText: 'a - b', newText: 'a + b' }] } },
        { name: 'bash', args: { command: testCommand, timeout: 15 } }
      ]
      const step =
        requests.length === 6
          ? {
              name: 'bash',
              args: {
                command: `"${process.execPath.replaceAll('\\', '/')}" "${slowScript.replaceAll('\\', '/')}"`,
                timeout: 45
              }
            }
          : steps[requests.length - 1]
      const delta = step
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `coding_${requests.length}`,
                type: 'function',
                function: { name: step.name, arguments: JSON.stringify(step.args) }
              }
            ]
          }
        : { role: 'assistant', content: 'Native Pi coding tools completed in Orca Chat UI.' }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: step ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    } catch (error) {
      fixtureErrors.push(String(error))
      response.writeHead(500).end()
    }
  })
  await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept))
  registerPostElectronShutdownCleanup(async () => {
    server.closeAllConnections()
    await new Promise<void>((accept, reject) =>
      server.close((error) => (error ? reject(error) : accept()))
    )
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture address')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
  await mkdir(join(userData, 'hive-native'), { recursive: true })
  await writeFile(
    join(userData, 'hive-native', 'bridge.json'),
    JSON.stringify({ baseUrl, token: bootstrap })
  )
  await orcaPage.evaluate(() => {
    return window.__store!.getState().updateSettings({
      defaultTuiAgent: 'hivecode',
      experimentalNativeChat: false,
      openAgentTabsInChatByDefault: false
    })
  })
  await orcaPage.getByRole('button', { name: 'New task', exact: true }).click()
  const picker = orcaPage.locator('.desktop-home-agent-picker').getByRole('combobox')
  await picker.click()
  await orcaPage.getByRole('option', { name: 'HiveCode AI', exact: true }).click()
  await orcaPage
    .getByRole('textbox', { name: 'Task description', exact: true })
    .fill('Repair the isolated addition fixture and run its test; only modify the fixture source.')
  await orcaPage.getByRole('button', { name: 'Send task', exact: true }).click()
  try {
    let acceptedFixtureTrust = false
    await expect
      .poll(
        async () => {
          if (!acceptedFixtureTrust) {
            acceptedFixtureTrust = await orcaPage.evaluate(async () => {
              const state = window.__store!.getState()
              const tab = Object.values(state.tabsByWorktree)
                .flat()
                .find((item) => item.launchAgent === 'hivecode')
              const pane = tab && window.__paneManagers?.get(tab.id)?.getPanes()[0]
              const screen = pane?.serializeAddon?.serialize() ?? ''
              if (
                !tab ||
                !tab.ptyId ||
                !screen.includes('Trust project folder?') ||
                !screen.includes('orca-e2e-userdata-')
              ) {
                return false
              }
              await window.api.pty.writeAccepted(tab.ptyId, '\r', 'driving')
              return true
            })
          }
          return requests.length
        },
        { timeout: 45_000 }
      )
      .toBe(5)
  } catch (error) {
    const diagnostic = await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      return {
        activeView: state.activeView,
        tabs: state.tabsByWorktree,
        unifiedTabs: state.unifiedTabsByWorktree,
        terminalText: [...(window.__paneManagers?.entries() ?? [])].map(([tabId, manager]) => ({
          tabId,
          panes: manager.getPanes().map((pane) => ({ text: pane.serializeAddon?.serialize?.() }))
        }))
      }
    })
    const descriptor = JSON.parse(
      await readFile(join(userData, 'hive-native', 'bridge.json'), 'utf8')
    )
    await writeFile(
      testInfo.outputPath('launch-diagnostic.json'),
      JSON.stringify(
        {
          diagnostic,
          fixturePaths,
          fixtureErrors,
          descriptorOrigin: descriptor.baseUrl,
          fixtureOrigin: baseUrl
        },
        null,
        2
      )
    )
    throw error
  }
  expect(fixtureErrors).toEqual([])
  expect(requests[0].tools?.some((tool) => tool.function?.name === 'read')).toBe(true)
  expect(
    requests[1].messages?.some(
      (message) =>
        message.role === 'tool' &&
        JSON.stringify(message.content).includes('native-chat-read-tool-proof')
    )
  ).toBe(true)
  const toolResults = (index: number) =>
    requests[index].messages
      ?.filter((message) => message.role === 'tool')
      .map((message) => JSON.stringify(message.content))
  expect(toolResults(2)?.at(-1)).toContain('AssertionError')
  expect(toolResults(4)?.at(-1)).toContain('NATIVE_CODING_TEST_PASS')
  expect(await readFile(sample, 'utf8')).toBe(repairedSource)
  await expect(
    orcaPage.getByText('Native Pi coding tools completed in Orca Chat UI.', { exact: true }).first()
  ).toBeVisible({ timeout: 30_000 })
  await expect(orcaPage.getByText('fixture-model', { exact: false }).first()).toBeVisible()
  const composer = orcaPage.getByRole('textbox', { name: 'Send a message…', exact: true })
  await expect(composer).toBeEnabled()
  await composer.fill('Run the isolated slow command so I can cancel it.')
  await orcaPage.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => requests.length, { timeout: 30_000 }).toBe(6)
  await expect
    .poll(() => readFile(slowStarted, 'utf8').catch(() => ''), { timeout: 15_000 })
    .not.toBe('')
  const slowPid = JSON.parse(await readFile(slowStarted, 'utf8')).pid as number
  const stop = orcaPage.getByRole('button', { name: 'Stop the agent', exact: true })
  await expect(stop).toBeEnabled()
  await stop.click()
  await expect
    .poll(
      () => {
        try {
          process.kill(slowPid, 0)
          return true
        } catch {
          return false
        }
      },
      { timeout: 15_000 }
    )
    .toBe(false)
  await composer.fill('Continue the same native session after cancelling the command.')
  await expect(orcaPage.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await orcaPage.getByRole('button', { name: 'Send', exact: true }).click()
  await expect.poll(() => requests.length, { timeout: 30_000 }).toBe(7)
  expect(JSON.stringify(requests[6]?.messages)).toContain('Command aborted')
  expect(await readFile(slowFinished, 'utf8').catch(() => null)).toBeNull()
  await expect(composer).toBeVisible()
  const nativeTab = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const terminal = Object.values(state.tabsByWorktree)
      .flat()
      .find((tab) => tab.launchAgent === 'hivecode')
    const tab = Object.values(state.unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.entityId === terminal?.id)
    return tab
      ? {
          contentType: tab.contentType,
          mode: tab.viewMode,
          customSession: tab.entityId.startsWith('ha-session:')
        }
      : null
  })
  expect(nativeTab).toEqual({ contentType: 'terminal', mode: 'chat', customSession: false })
  await expect(orcaPage.getByTestId('session-content-loading')).toHaveCount(0)
  const beforeToggle = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const terminal = Object.values(state.tabsByWorktree)
      .flat()
      .find((tab) => tab.launchAgent === 'hivecode')!
    const tab = Object.values(state.unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.entityId === terminal.id)!
    state.setTabViewMode(tab.id, 'terminal')
    return { id: terminal.id, tabId: tab.id, ptyId: terminal.ptyId }
  })
  await expect(composer).toHaveCount(0)
  await expect
    .poll(async () =>
      orcaPage.evaluate((id) => {
        const pane = window.__paneManagers?.get(id)?.getPanes()[0]
        if (!pane) {
          return ''
        }
        const buffer = pane.terminal.buffer.active
        return Array.from(
          { length: pane.terminal.rows },
          (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ''
        ).join('\n')
      }, beforeToggle.id)
    )
    .toContain('fixture-model')
  await orcaPage.screenshot({ path: testInfo.outputPath('native-pi-tui.png') })
  await orcaPage.evaluate(({ id, tabId, ptyId }) => {
    const state = window.__store!.getState()
    const terminal = Object.values(state.tabsByWorktree)
      .flat()
      .find((tab) => tab.id === id)
    if (terminal?.ptyId !== ptyId) {
      throw new Error('Display mode switch replaced the native PTY')
    }
    state.setTabViewMode(tabId, 'chat')
  }, beforeToggle)
  await expect(composer).toBeVisible()
  for (const theme of ['light', 'dark'] as const) {
    await orcaPage.evaluate(
      (value) => window.__store!.getState().updateSettings({ theme: value }),
      theme
    )
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.3)
    )
    await expect(composer).toBeInViewport()
    const bounds = await composer.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }
    })
    expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1)
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1)
    await orcaPage.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    // CDP page screenshots can crop an Electron viewport after changing its zoom.
    const screenshot = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return (await window.webContents.capturePage()).toPNG().toString('base64')
    })
    await writeFile(
      testInfo.outputPath(`native-pi-chat-${theme}.png`),
      Buffer.from(screenshot, 'base64')
    )
    await expect(composer).toBeVisible()
  }
  await writeFile(
    testInfo.outputPath('native-tool-evidence.json'),
    JSON.stringify(
      {
        requests: requests.length,
        nativeTools: ['read', 'bash', 'edit'],
        failedBeforeRepair: true,
        passedAfterRepair: true,
        replied: true,
        stopDuringNativeBash: { childPid: slowPid, childExited: true, continued: true },
        tab: nativeTab
      },
      null,
      2
    )
  )
})
