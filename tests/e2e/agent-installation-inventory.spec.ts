import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { test, expect } from './helpers/orca-app'

const fixtureRoot = path.resolve('logs/agent-lifecycle-analysis/fixtures', randomUUID())
const first = path.join(fixtureRoot, 'first')
const second = path.join(fixtureRoot, 'second')
for (const [directory, version] of [
  [first, '1.0.0'],
  [second, '2.0.0']
]) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, process.platform === 'win32' ? 'codex.cmd' : 'codex'),
    process.platform === 'win32'
      ? `@echo off\r\necho codex ${version}\r\n`
      : `#!/bin/sh\nprintf 'codex ${version}\\n'\n`,
    { mode: 0o755 }
  )
}
test.use({
  seedTestRepo: false,
  launchEnv: {
    PATH: [first, second, process.env.PATH ?? process.env.Path ?? ''].join(path.delimiter)
  }
})

test('shows actual installation inventory over IPC in both themes without installing software', async ({
  electronApp
}) => {
  const page = await electronApp.firstWindow()
  await page.waitForFunction(() => Boolean(window.__store?.getState().settings))
  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({
      uiLanguage: 'en',
      theme: 'light',
      localWindowsRuntimeDefault: { kind: 'windows-host' }
    })
    window.__store!.getState().openSettingsTarget({ pane: 'agents', repoId: null })
    window.__store!.getState().openSettingsPage()
  })
  const card = page.locator('#agent-card-codex')
  await expect(card).toHaveAttribute('data-installed', 'true', { timeout: 30_000 })
  await expect(card.getByText('1.0.0', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Installation details' })).toBeVisible({
    timeout: 30_000
  })
  await card.getByRole('button', { name: 'Installation details' }).click()
  const details = card.getByRole('region', { name: 'Installation details' })
  await expect(details.getByText('Used by HiveCode')).toBeVisible({ timeout: 120_000 })
  await expect(
    details.getByText(path.join(first, process.platform === 'win32' ? 'codex.cmd' : 'codex'), {
      exact: true
    })
  ).toBeVisible()
  await expect(
    details.getByText(path.join(second, process.platform === 'win32' ? 'codex.cmd' : 'codex'), {
      exact: true
    })
  ).toBeVisible()
  await expect(details.getByText(/Multiple installations have different/)).toBeVisible()
  await page.screenshot({
    path: 'logs/agent-lifecycle-analysis/inventory-light.png',
    animations: 'disabled'
  })
  await page.evaluate(async () => {
    await window.__store!.getState().updateSettings({ theme: 'dark' })
  })
  await page.setViewportSize({ width: 1000, height: 900 })
  await expect(details.getByRole('button', { name: 'Refresh detection' })).toBeVisible()
  await details.scrollIntoViewIfNeeded()
  await page.screenshot({
    path: 'logs/agent-lifecycle-analysis/inventory-dark.png',
    animations: 'disabled'
  })
})
