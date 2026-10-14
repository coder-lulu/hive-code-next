import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { toRuntimeExecutionHostId } from '../../src/shared/execution-host'
import { shellEscape } from '../../src/main/ssh/ssh-connection-utils'
import { readPairedPaneContent } from './helpers/paired-host-terminal'
import {
  launchManagedWorkspace,
  skipUnlessManagedDockerHost,
  terminalTabIds,
  withManagedHost,
  type ManagedHostFixture
} from './helpers/orcad-managed-workspace'

skipUnlessManagedDockerHost()
test.skip(process.platform === 'win32', 'The Docker SSH host uses POSIX tooling')
const DEFAULT_HOME = '/root/.codex'
const ACCOUNT_ID = 'history-e2e'
// Same managed server root selected by orcad-remote-context; protocol storage name is not branding.
const MANAGED_HOME = `/root/.orca/codex-accounts/${ACCOUNT_ID}/home`

function writeRemote(fixture: ManagedHostFixture, path: string, content: string, mode = '600') {
  if (!fixture.host.exec) {
    throw new Error('Managed Docker command port unavailable')
  }
  const encoded = Buffer.from(content).toString('base64')
  fixture.host.exec(
    `mkdir -p ${shellEscape(path.slice(0, path.lastIndexOf('/')))} && printf '%s' ${shellEscape(encoded)} | base64 -d > ${shellEscape(path)} && chmod ${mode} ${shellEscape(path)}`
  )
}
function installCodexProbe(fixture: ManagedHostFixture) {
  writeRemote(
    fixture,
    '/usr/local/bin/codex',
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.99.0"; exit 0; fi\nprintf "MANAGED_CODEX cwd=%s home=%s args=%s\\n" "$(pwd)" "$CODEX_HOME" "$*"\n',
    '755'
  )
}
function seedCodex(
  fixture: ManagedHostFixture,
  home: string,
  sessionId: string,
  title: string,
  cwd: string
) {
  const timestamp = '2026-07-04T01:00:00.000Z'
  writeRemote(
    fixture,
    `${home}/session_index.jsonl`,
    `${JSON.stringify({ id: sessionId, thread_name: title })}\n`
  )
  writeRemote(
    fixture,
    `${home}/sessions/2026/07/04/${sessionId}.jsonl`,
    `${[
      { timestamp, type: 'session_meta', payload: { id: sessionId, cwd } },
      {
        timestamp,
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'text', text: title }] }
      }
    ]
      .map((row) => JSON.stringify(row))
      .join('\n')}\n`
  )
}
async function openHistory(page: Page) {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('vault')
    state.setRightSidebarWidth(450)
  })
}
async function selectHistoryHost(page: Page, label: string | RegExp) {
  await page.getByRole('button', { name: /Session History host:/ }).click()
  await page.getByRole('menuitemradio', { name: label, exact: typeof label === 'string' }).click()
}
async function resumeAndObserve(
  page: Page,
  worktreeId: string,
  title: string,
  label: string,
  sessionId: string,
  cwd: string,
  home: string
) {
  const before = new Set(await terminalTabIds(page, worktreeId))
  await page.getByText(title, { exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: label, exact: true }).click()
  let created: string | undefined
  await expect
    .poll(
      async () => {
        created = (await terminalTabIds(page, worktreeId)).find((id) => !before.has(id))
        return created
      },
      { timeout: 60_000 }
    )
    .toBeTruthy()
  // Read the actual host-spawned pane; neither a queued command nor an IPC return proves execution.
  await expect
    .poll(() => readPairedPaneContent(page, created!), { timeout: 60_000 })
    .toContain(`MANAGED_CODEX cwd=${cwd} home=${home} args=`)
  const output = await readPairedPaneContent(page, created!)
  expect(output).toContain(`resume ${sessionId}`)
  expect(output).toContain('tui.resume_cwd=current')
}

test('managed history isolates host scope and resumes default and managed Codex homes on that runtime', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its managed app launches.
{}, testInfo) => {
  test.setTimeout(12 * 60_000)
  await withManagedHost(testInfo, async (fixture) => {
    installCodexProbe(fixture)
    const { page, seeded, environmentId } = await launchManagedWorkspace(fixture)
    const stamp = Date.now()
    const defaultId = `default-${stamp}`,
      managedId = `managed-${stamp}`,
      claudeId = `claude-${stamp}`
    const defaultTitle = `Default host history ${stamp}`,
      managedTitle = `Managed account history ${stamp}`,
      claudeTitle = `Claude host history ${stamp}`
    seedCodex(fixture, DEFAULT_HOME, defaultId, defaultTitle, fixture.host.remoteRepoPath)
    writeRemote(fixture, `${MANAGED_HOME}/.orca-managed-home`, `${ACCOUNT_ID}\n`)
    seedCodex(fixture, MANAGED_HOME, managedId, managedTitle, fixture.host.remoteRepoPath)
    writeRemote(
      fixture,
      `/root/.claude/projects/managed/${claudeId}.jsonl`,
      `${JSON.stringify({
        sessionId: claudeId,
        cwd: fixture.host.remoteRepoPath,
        timestamp: '2026-07-04T01:00:00.000Z',
        type: 'user',
        message: { content: [{ type: 'text', text: claudeTitle }] }
      })}\n`
    )
    const hostId = toRuntimeExecutionHostId(environmentId)
    const scan = await page.evaluate(
      async ({ hostId }) => {
        const local = await window.api.aiVault.listSessions({
          executionHostScope: 'local',
          force: true
        })
        const remote = await window.api.aiVault.listSessions({
          executionHostScope: hostId,
          force: true
        })
        const all = await window.api.aiVault.listSessions({
          executionHostScope: 'all',
          force: true
        })
        const environments = await window.api.runtimeEnvironments.list()
        return { local: local.sessions, remote: remote.sessions, all: all.sessions, environments }
      },
      { hostId }
    )
    const expectedTitles = [defaultTitle, managedTitle, claudeTitle]
    expect(scan.local.some((row) => expectedTitles.includes(row.title))).toBe(false)
    expect(scan.remote.map((row) => row.title)).toEqual(expect.arrayContaining(expectedTitles))
    expect(scan.all.map((row) => row.title)).toEqual(expect.arrayContaining(expectedTitles))
    expect(
      new Set(
        scan.remote
          .filter((row) => expectedTitles.includes(row.title))
          .map((row) => row.executionHostId)
      )
    ).toEqual(new Set([hostId]))
    expect(scan.remote.find((row) => row.sessionId === defaultId)?.codexHome).toBe(DEFAULT_HOME)
    expect(scan.remote.find((row) => row.sessionId === managedId)?.codexHome).toBe(MANAGED_HOME)
    await openHistory(page)
    await expect(page.getByText(defaultTitle, { exact: true }).first()).toBeVisible({
      timeout: 30_000
    })
    await selectHistoryHost(page, /^Local/)
    await expect(page.getByText(defaultTitle, { exact: true })).toHaveCount(0)
    await selectHistoryHost(page, 'All hosts')
    await expect(page.getByText(managedTitle, { exact: true }).first()).toBeVisible({
      timeout: 30_000
    })
    const runtimeLabel = scan.environments.find((row) => row.id === environmentId)?.name
    if (!runtimeLabel) {
      throw new Error('Managed runtime has no label')
    }
    await selectHistoryHost(page, runtimeLabel)
    await resumeAndObserve(
      page,
      seeded.worktreeId,
      defaultTitle,
      'Resume in Worktree',
      defaultId,
      fixture.host.remoteRepoPath,
      DEFAULT_HOME
    )
    await resumeAndObserve(
      page,
      seeded.worktreeId,
      managedTitle,
      'Resume in Worktree',
      managedId,
      fixture.host.remoteRepoPath,
      MANAGED_HOME
    )
  })
})

test('managed history resumes a deleted recorded directory in the current host repository', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its managed app launches.
{}, testInfo) => {
  test.setTimeout(12 * 60_000)
  await withManagedHost(testInfo, async (fixture) => {
    installCodexProbe(fixture)
    const { page, seeded, environmentId } = await launchManagedWorkspace(fixture, {
      folderPath: fixture.host.remoteRepoPath
    })
    const stamp = Date.now(),
      sessionId = `deleted-${stamp}`,
      title = `Deleted directory ${stamp}`
    const missing = `/tmp/never-created-history-${stamp}`
    seedCodex(fixture, DEFAULT_HOME, sessionId, title, missing)
    const row = await page.evaluate(
      async (hostId) =>
        (await window.api.aiVault.listSessions({ executionHostScope: hostId, force: true }))
          .sessions,
      toRuntimeExecutionHostId(environmentId)
    )
    expect(row.find((item) => item.sessionId === sessionId)?.cwd).toBe(missing)
    await openHistory(page)
    await page.getByRole('radio', { name: 'All', exact: true }).click()
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await resumeAndObserve(
      page,
      seeded.worktreeId,
      title,
      'Resume in New Tab',
      sessionId,
      fixture.host.remoteRepoPath,
      DEFAULT_HOME
    )
    // The session record remains historical evidence; only this launch changed directories.
    const after = await page.evaluate(
      async (hostId) =>
        (await window.api.aiVault.listSessions({ executionHostScope: hostId, force: true }))
          .sessions,
      toRuntimeExecutionHostId(environmentId)
    )
    expect(after.find((item) => item.sessionId === sessionId)?.cwd).toBe(missing)
  })
})
