import { createServer, type ServerResponse } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { getPiAgentStatusExtensionSource } from '../../src/main/pi/agent-status-extension-source'
import { getPiPrefillExtensionSource } from '../../src/main/pi/prefill-extension-source'
import { getPiTitlebarExtensionSource } from '../../src/main/pi/titlebar-extension-source'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

test('two native Pi sessions keep relative edits and chat isolated by UI-selected worktree', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  const worktrees = await orcaPage.evaluate(async () => {
    const store = window.__store!
    const repo = store.getState().repos.find((item) => item.path.includes('orca-e2e-repo-'))!
    await store.getState().fetchWorktrees(repo.id)
    return store
      .getState()
      .worktreesByRepo[repo.id]!.slice(0, 2)
      .map(({ id, path, displayName }) => ({ id, path, name: displayName }))
  })
  expect(worktrees).toHaveLength(2)
  const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  expect(userData).toContain('orca-e2e-userdata-')
  const agentDirectory = testInfo.outputPath('agent')
  const extensions = join(agentDirectory, 'extensions')
  await mkdir(extensions, { recursive: true })
  await Promise.all([
    writeFile(join(extensions, 'orca-agent-status.ts'), getPiAgentStatusExtensionSource('pi')),
    writeFile(join(extensions, 'orca-prefill.ts'), getPiPrefillExtensionSource('pi')),
    writeFile(join(extensions, 'orca-titlebar-spinner.ts'), getPiTitlebarExtensionSource('pi'))
  ])
  for (const [index, worktree] of worktrees.entries()) {
    expect(worktree.path).toMatch(/orca-e2e-(repo|worktree)-/)
    await writeFile(join(worktree.path, 'p5c-value.mjs'), "export const value = 'BASE';\n")
    await writeFile(join(worktree.path, 'p5c-sentinel.txt'), `SENTINEL_${index}\n`)
    await writeFile(
      join(worktree.path, 'p5c-test.mjs'),
      `import assert from 'node:assert/strict'; import {value} from './p5c-value.mjs'; assert.equal(value, 'LANE_${index}'); console.log('PASS_${index}');\n`
    )
  }
  const bootstrap = 'a'.repeat(43),
    lease = 'b'.repeat(43)
  const requests: Record<number, { messages: { role: string; content: unknown }[] }[]> = {
    0: [],
    1: []
  }
  const pending: (() => void)[] = []
  const errors: string[] = []
  let baseUrl = ''
  let simultaneous = false
  function respond(response: ServerResponse, lane: number, step: number): void {
    const tools = [
      { name: 'read', args: { path: 'p5c-value.mjs' } },
      {
        name: 'edit',
        args: { path: 'p5c-value.mjs', edits: [{ oldText: 'BASE', newText: `LANE_${lane}` }] }
      },
      {
        name: 'bash',
        args: { command: `"${process.execPath.replaceAll('\\', '/')}" p5c-test.mjs`, timeout: 15 }
      }
    ]
    const tool = tools[step]
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `lane_${lane}_${step}`,
              type: 'function',
              function: { name: tool.name, arguments: JSON.stringify(tool.args) }
            }
          ]
        }
      : { role: 'assistant', content: `P5C_COMPLETE_LANE_${lane}` }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(
      `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`
    )
  }
  const server = createServer(async (request, response) => {
    try {
      if (
        request.headers.authorization !== `Bearer ${request.url === '/launch' ? bootstrap : lease}`
      ) {
        throw new Error('Fixture authentication failed')
      }
      if (request.url === '/launch' || request.url === '/lease') {
        response.setHeader('Content-Type', 'application/json')
        response.end(
          JSON.stringify(
            request.url === '/lease'
              ? {}
              : {
                  token: lease,
                  baseUrl: `${baseUrl}/v1`,
                  runtimeDirectory: resolve(`out/native-pi/${process.platform}-${process.arch}`),
                  agentDirectory,
                  models: [
                    {
                      modelId: 'fixture-model',
                      protocols: ['CHAT_COMPLETIONS'],
                      contextWindow: 32768,
                      maxOutputTokens: 4096
                    }
                  ],
                  selection: null
                }
          )
        )
        return
      }
      if (request.url !== '/v1/chat/completions') {
        throw new Error(`Unexpected path ${request.url}`)
      }
      let body = ''
      for await (const chunk of request) {
        body += chunk
      }
      const parsed = JSON.parse(body)
      const user = parsed.messages.find((m: { role: string }) => m.role === 'user')
      const match = JSON.stringify(user).match(/P5C_LANE_([01])/)
      if (!match) {
        throw new Error('Missing lane prompt')
      }
      const lane = Number(match[1])
      const step = requests[lane].push(parsed) - 1
      if (step === 0) {
        pending.push(() => respond(response, lane, step))
        if (pending.length === 2) {
          simultaneous = true
          pending.forEach((send) => send())
        }
      } else {
        respond(response, lane, step)
      }
    } catch (error) {
      errors.push(String(error))
      response.writeHead(500).end()
    }
  })
  await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept))
  registerPostElectronShutdownCleanup(async () => {
    server.closeAllConnections()
    await new Promise<void>((accept) => server.close(() => accept()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture port')
  }
  baseUrl = `http://127.0.0.1:${address.port}`
  await mkdir(join(userData, 'hive-native'), { recursive: true })
  await writeFile(
    join(userData, 'hive-native', 'bridge.json'),
    JSON.stringify({ baseUrl, token: bootstrap })
  )
  await orcaPage.evaluate(() =>
    window
      .__store!.getState()
      .updateSettings({ defaultTuiAgent: 'hivecode', openAgentTabsInChatByDefault: true })
  )
  for (const [lane, worktree] of worktrees.entries()) {
    await orcaPage.getByRole('button', { name: 'New task', exact: true }).click()
    await orcaPage
      .getByRole('button', { name: 'Select a project or workspace', exact: true })
      .click()
    await orcaPage
      .getByRole('menuitem')
      .filter({ hasText: ` / ${worktree.name}` })
      .click()
    await orcaPage.locator('.desktop-home-agent-picker').getByRole('combobox').click()
    await orcaPage.getByRole('option', { name: 'HiveCode AI', exact: true }).click()
    await orcaPage
      .getByRole('textbox', { name: 'Task description', exact: true })
      .fill(`P5C_LANE_${lane}: repair and test p5c-value.mjs only in the selected worktree.`)
    await orcaPage.getByRole('button', { name: 'Send task', exact: true }).click()
    await expect
      .poll(
        async () => {
          await orcaPage.evaluate(async (worktreeId) => {
            const tabs = window.__store!.getState().tabsByWorktree[worktreeId] ?? []
            for (const tab of tabs.filter((t) => t.launchAgent === 'hivecode')) {
              const pane = window.__paneManagers?.get(tab.id)?.getPanes()[0]
              if (
                pane?.serializeAddon?.serialize().includes('Trust project folder?') &&
                tab.ptyId
              ) {
                await window.api.pty.writeAccepted(tab.ptyId, '\r', 'driving')
              }
            }
          }, worktree.id)
          return requests[lane].length
        },
        { timeout: 45_000 }
      )
      .toBeGreaterThan(0)
  }
  await expect
    .poll(() => [requests[0].length, requests[1].length], { timeout: 45_000 })
    .toEqual([4, 4])
  expect(simultaneous).toBe(true)
  expect(errors).toEqual([])
  for (const [lane, worktree] of worktrees.entries()) {
    expect(await readFile(join(worktree.path, 'p5c-value.mjs'), 'utf8')).toBe(
      `export const value = 'LANE_${lane}';\n`
    )
    expect(await readFile(join(worktree.path, 'p5c-sentinel.txt'), 'utf8')).toBe(
      `SENTINEL_${lane}\n`
    )
    expect(JSON.stringify(requests[lane][3].messages.filter((m) => m.role === 'tool'))).toContain(
      `PASS_${lane}`
    )
    await orcaPage.getByRole('button', { name: 'Projects', exact: true }).click()
    await orcaPage.locator(`[role="option"][data-worktree-id="${worktree.id}"]`).click()
    await expect(
      orcaPage.getByText(`P5C_COMPLETE_LANE_${lane}`, { exact: true }).first()
    ).toBeVisible()
    await expect(orcaPage.getByText(`P5C_COMPLETE_LANE_${1 - lane}`, { exact: true })).toHaveCount(
      0
    )
  }
  await writeFile(
    testInfo.outputPath('isolation.json'),
    JSON.stringify(
      {
        simultaneous,
        worktrees,
        model: 'local protocol fixture',
        tools: ['read', 'edit', 'bash'],
        lanes: 2,
        sentinelsPreserved: true,
        visibleChatIsolated: true
      },
      null,
      2
    )
  )
})
