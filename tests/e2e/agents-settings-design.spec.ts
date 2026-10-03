import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { expect, test } from './helpers/orca-app'

test.use({ seedTestRepo: false })

test('renders the three agent settings views with real detection, keyboard editing and responsive themes', async ({
  orcaPage: page
}, testInfo) => {
  await page.setViewportSize({ width: 1650, height: 1100 })
  await page.evaluate(async () => {
    const store = window.__store!
    await store
      .getState()
      .updateSettings({ uiLanguage: 'zh', theme: 'light', defaultTuiAgent: null })
    store.getState().openSettingsTarget({ pane: 'agents', repoId: null })
    store.getState().openSettingsPage()
  })
  const settings = page.locator('[data-settings-section="agents"]')
  await expect(settings.getByRole('heading', { name: '智能体', exact: true })).toBeVisible()
  await expect(settings.getByRole('tab', { name: '智能体管理' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(settings.getByText('管理编码智能体与启动偏好', { exact: true })).toBeVisible()
  await expect(settings.getByRole('button', { name: '刷新检测' })).toBeVisible()
  await expect(settings.getByText(/检测已安装的智能体/)).toHaveCount(0, {
    timeout: 30_000
  })
  const screenshots = process.env.ORCA_AGENTS_DESIGN_EVIDENCE_DIR ?? testInfo.outputDir
  mkdirSync(screenshots, { recursive: true })
  const capture = (name: string) =>
    page.screenshot({ path: path.join(screenshots, name), animations: 'disabled' })
  const installed = settings.locator('.agent-management-card[data-installed="true"]')
  const installedCount = await installed.count()
  if (installedCount > 0) {
    await expect(installed.locator('.animate-spin')).toHaveCount(0, { timeout: 30_000 })
    await expect(installed.first().getByText('当前版本', { exact: true })).toBeVisible()
    await expect(installed.first().getByText('最新版本', { exact: false })).toBeVisible()
    await expect(settings.locator('.agents-installed-grid')).toHaveCSS(
      'grid-template-columns',
      /^\d+(?:\.\d+)?px \d+(?:\.\d+)?px$/
    )
  }
  const availableGrid = settings.locator('.agents-available-grid')
  if (await availableGrid.count()) {
    await expect(availableGrid).toHaveCSS(
      'grid-template-columns',
      /^\d+(?:\.\d+)?px \d+(?:\.\d+)?px \d+(?:\.\d+)?px$/
    )
  }
  await capture('agents-management-light.png')
  if (await availableGrid.count()) {
    await settings
      .locator('#agents-available')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await capture('agents-management-available-light.png')
  }
  await (
    installedCount > 0
      ? installed.first().getByRole('button', { name: /的启动配置$/ })
      : settings.getByRole('tab', { name: '高级配置' })
  ).click()
  await expect(settings.getByRole('tab', { name: '高级配置' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  const advanced = settings.getByRole('tabpanel', { name: '高级配置' })
  if (installedCount > 0) {
    await expect(advanced.locator('[data-agent-config-heading]:visible')).toBeFocused()
    const command = advanced.getByRole('textbox').first()
    const original = await command.inputValue()
    await command.fill('discard-this-uncommitted-command')
    await command.press('Escape')
    await expect(command).toHaveValue(original)
  }
  await capture('agents-advanced-light.png')
  await settings.getByRole('tab', { name: '运行偏好' }).click()
  const preferences = settings.getByRole('tabpanel', { name: '运行偏好' })
  await expect(preferences.getByRole('radiogroup', { name: '智能体权限' })).toBeVisible()
  await expect(preferences.getByRole('radiogroup', { name: '防止电脑休眠' })).toBeVisible()
  await capture('agents-preferences-light.png')
  const search = page.getByPlaceholder('搜索设置', { exact: true })
  await search.fill('启动参数')
  await expect(settings.getByRole('tab', { name: '高级配置' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(search).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(search).toHaveValue('启动参')
  await expect(search).toBeFocused()
  await page.keyboard.insertText('数')
  await expect(search).toHaveValue('启动参数')
  await expect(search).toBeFocused()
  await search.fill('')
  await page.evaluate(() => window.__store!.getState().updateSettings({ theme: 'dark' }))
  await expect(page.locator('html')).toHaveClass(/dark/)
  for (const [name, filename] of [
    ['高级配置', 'agents-advanced-dark.png'],
    ['运行偏好', 'agents-preferences-dark.png'],
    ['智能体管理', 'agents-management-dark.png']
  ]) {
    await settings.getByRole('tab', { name }).click()
    await capture(filename)
  }
  await page.setViewportSize({ width: 1250, height: 1100 })
  if (await availableGrid.count()) {
    await expect(availableGrid).toHaveCSS(
      'grid-template-columns',
      /^\d+(?:\.\d+)?px \d+(?:\.\d+)?px$/
    )
  }
  await capture('agents-management-medium-dark.png')
  await page.setViewportSize({ width: 1000, height: 1100 })
  if (await availableGrid.count()) {
    await expect(availableGrid).toHaveCSS('grid-template-columns', /^(?!.*\s)\d+(?:\.\d+)?px$/)
  }
  await capture('agents-management-compact-dark.png')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%'
  })
  await settings.getByRole('tab', { name: '运行偏好' }).click()
  await expect(preferences.getByRole('radiogroup', { name: '智能体权限' })).toBeVisible()
  await capture('agents-preferences-font-130-dark.png')
  await settings.getByRole('tab', { name: '高级配置' }).click()
  await capture('agents-advanced-font-130-dark.png')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''
  })
})
