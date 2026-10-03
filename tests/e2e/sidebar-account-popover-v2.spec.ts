import path from 'node:path'
import { APP_DISPLAY_NAME } from '../../src/shared/brand'
import { test, expect } from './helpers/orca-app'

test.use({ seedTestRepo: false, dismissOnboarding: true })

const ownership = (relation: 'UNREGISTERED' | 'CLAIMED_BY_CURRENT') => ({
  stateRevision: 2,
  relation,
  accountId: 'account-1',
  sessionGeneration: 1,
  runtimeRecordId:
    relation === 'CLAIMED_BY_CURRENT' ? '723e4567-e89b-42d3-a456-426614174000' : null,
  claimCapabilityAvailable: relation === 'UNREGISTERED',
  presence: 'ONLINE' as const,
  checkedAt: Date.now(),
  errorCode: null
})

test('matches the v2 account popover hierarchy for unclaimed and claimed devices', async ({
  electronApp,
  orcaPage
}) => {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('hiveAccount:getState')
    ipcMain.handle('hiveAccount:getState', () => ({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      sessionProfile: 'TRUSTED',
      account: { accountId: 'account-1', displayName: 'coder' }
    }))
  })
  await orcaPage.reload()
  await orcaPage.waitForFunction(() => Boolean(window.__store))
  await orcaPage.evaluate(async (nextOwnership) => {
    const store = window.__store
    if (!store) {
      return
    }
    await store
      .getState()
      .updateSettings({ uiLanguage: 'zh', theme: 'light', experimentalActivity: true })
    store.setState({ localRuntimeOwnership: nextOwnership })
  }, ownership('UNREGISTERED'))

  const trigger = orcaPage.locator('[data-sidebar-account-trigger]')
  await expect(trigger).toContainText('coder')
  await trigger.click({ force: true })

  const popover = orcaPage.locator('[data-account-popover]')
  const identity = popover.locator('[data-account-identity]')
  const ownershipControl = popover.locator('[data-local-runtime-ownership]')
  const capture = async (name: string): Promise<void> => {
    await orcaPage.screenshot({
      path: path.resolve(`.omx/state/sidebar-account-popover-v2/${name}.png`),
      animations: 'disabled'
    })
  }
  await expect(popover).toBeVisible()
  await expect(identity).toContainText('coder')
  await expect(identity).toContainText('HiveCloud 账户')
  await expect(identity).toContainText('工作账号')
  await expect(identity).not.toContainText('蜂核智能')
  await expect(ownershipControl).toContainText('未认领 · 认领设备')
  await expect(popover.getByText('设置', { exact: true })).toBeVisible()
  await expect(popover.getByText('外观', { exact: true })).toBeVisible()
  await expect(popover.getByText('通知中心', { exact: true })).toBeVisible()
  await expect(popover.getByText('无未读', { exact: true })).toBeVisible()
  await expect(popover.getByText('帮助与反馈', { exact: true })).toBeVisible()
  await expect(popover.getByText('检查更新', { exact: true })).toBeVisible()
  await expect(popover.getByText(`重启 ${APP_DISPLAY_NAME}`, { exact: true })).toBeVisible()
  await expect(popover.getByText('退出登录', { exact: true })).toBeVisible()
  await expect(popover.getByText('账户中心', { exact: true })).toHaveCount(0)
  await expect(popover.getByText('设备与会话', { exact: true })).toHaveCount(0)
  await expect(popover.getByText('当前设备', { exact: true })).toHaveCount(0)

  const bounds = await popover.boundingBox()
  expect(bounds?.width).toBeGreaterThanOrEqual(420)
  expect(bounds?.width).toBeLessThanOrEqual(450)
  expect(bounds?.height).toBeLessThanOrEqual(680)
  await capture('unclaimed-light')

  const identityTarget = identity.locator('.hive-account-popover-identity-hit-target')
  const identityBackground = await identityTarget.evaluate(
    (element) => window.getComputedStyle(element).backgroundColor
  )
  await identityTarget.hover({ position: { x: 300, y: 64 } })
  await expect
    .poll(() =>
      identityTarget.evaluate((element) => window.getComputedStyle(element).backgroundColor)
    )
    .not.toBe(identityBackground)
  await capture('identity-hover')

  await orcaPage.mouse.move(800, 400)
  const claimBackground = await ownershipControl.evaluate(
    (element) => window.getComputedStyle(element).backgroundColor
  )
  await ownershipControl.hover()
  await expect
    .poll(() =>
      ownershipControl.evaluate((element) => window.getComputedStyle(element).backgroundColor)
    )
    .not.toBe(claimBackground)
  await capture('claim-hover')

  const lightTheme = popover.getByRole('radio', { name: '浅色' })
  const darkTheme = popover.getByRole('radio', { name: '深色' })
  await lightTheme.focus()
  await orcaPage.keyboard.press('ArrowRight')
  await expect(darkTheme).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => orcaPage.locator('html').getAttribute('class')).toContain('dark')
  await orcaPage.keyboard.press('ArrowLeft')
  await expect(lightTheme).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => orcaPage.locator('html').getAttribute('class')).not.toContain('dark')

  await orcaPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      return
    }
    store.setState({
      claimLocalRuntimeForAccount: async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 5_000))
        const claimed = {
          stateRevision: 3,
          relation: 'CLAIMED_BY_CURRENT' as const,
          accountId: 'account-1',
          sessionGeneration: 1,
          runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
          claimCapabilityAvailable: false,
          presence: 'ONLINE' as const,
          checkedAt: Date.now(),
          errorCode: null
        }
        store.setState({ localRuntimeOwnership: claimed })
        return claimed
      }
    })
  })
  await ownershipControl.click()
  await expect(ownershipControl).toContainText('认领中…')
  await expect(ownershipControl).toHaveAttribute('role', 'status')
  await capture('claim-loading')
  await expect(ownershipControl).toContainText('认领成功', { timeout: 7_000 })
  await capture('claim-success')
  await expect(ownershipControl).toContainText('已认领')
  await expect(ownershipControl).toHaveAttribute('role', 'status')
  await capture('claimed-light')

  await orcaPage.evaluate((nextOwnership) => {
    const store = window.__store
    if (!store) {
      return
    }
    store.setState({
      localRuntimeOwnership: nextOwnership,
      claimLocalRuntimeForAccount: async () => {
        throw new Error('Visual test claim failure')
      }
    })
  }, ownership('UNREGISTERED'))
  await expect(ownershipControl).toContainText('未认领 · 认领设备')
  await ownershipControl.click()
  await expect(ownershipControl).toContainText('认领失败 · 重试')
  await capture('claim-failure')

  await orcaPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      return
    }
    store.setState({
      claimLocalRuntimeForAccount: async () => {
        const claimed = {
          stateRevision: 4,
          relation: 'CLAIMED_BY_CURRENT' as const,
          accountId: 'account-1',
          sessionGeneration: 1,
          runtimeRecordId: '723e4567-e89b-42d3-a456-426614174000',
          claimCapabilityAvailable: false,
          presence: 'ONLINE' as const,
          checkedAt: Date.now(),
          errorCode: null
        }
        store.setState({ localRuntimeOwnership: claimed })
        return claimed
      }
    })
  })
  await ownershipControl.click()
  await expect(ownershipControl).toContainText('认领成功')
  await expect(ownershipControl).toContainText('已认领', { timeout: 3_000 })

  await orcaPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      return
    }
    const now = Date.now()
    const unreadEntries = Object.fromEntries(
      [1, 2, 3].map((index) => {
        const paneKey = `visual-unread-${index}`
        return [
          paneKey,
          {
            state: 'done' as const,
            prompt: '',
            updatedAt: now,
            stateStartedAt: now,
            paneKey,
            stateHistory: []
          }
        ]
      })
    )
    const state = store.getState()
    store.setState({
      agentStatusByPaneKey: unreadEntries,
      retainedAgentsByPaneKey: {},
      migrationUnsupportedByPtyId: {},
      acknowledgedAgentsByPaneKey: {},
      sortEpoch: state.sortEpoch + 1
    })
  })
  await expect(popover.getByText('3 条未读', { exact: true })).toBeVisible()
  await capture('notification-unread')

  await orcaPage.evaluate(() => {
    window.__store?.setState({ updateStatus: { state: 'checking' } })
  })
  await expect(popover.getByText('检查中…', { exact: true })).toBeVisible()
  await capture('update-checking')

  await orcaPage.evaluate(() => {
    window.__store?.setState({ updateStatus: { state: 'idle' } })
  })
  const signOut = popover.getByRole('menuitem', { name: '退出登录' })
  const signOutBackground = await signOut.evaluate(
    (element) => window.getComputedStyle(element).backgroundColor
  )
  await signOut.hover()
  await expect
    .poll(() => signOut.evaluate((element) => window.getComputedStyle(element).backgroundColor))
    .not.toBe(signOutBackground)
  await capture('sign-out-hover')
  await orcaPage.mouse.move(800, 400)

  await orcaPage.evaluate(async () => {
    await window.__store?.getState().updateSettings({ theme: 'dark' })
  })
  await expect.poll(() => orcaPage.locator('html').getAttribute('class')).toContain('dark')
  await expect(identity).toBeVisible()
  await expect(popover.getByText('退出登录', { exact: true })).toBeVisible()
  await capture('claimed-dark')

  await orcaPage.setViewportSize({ width: 720, height: 480 })
  const compactSignOut = popover.getByText('退出登录', { exact: true })
  const menuScroll = popover.locator('.hive-account-menu-scroll')
  await expect(identity).toBeInViewport({ ratio: 1 })
  await expect(compactSignOut).toBeInViewport({ ratio: 1 })
  const compactMetrics = await popover.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      clientHeight: element.clientHeight,
      maxHeight: Number.parseFloat(style.maxHeight)
    }
  })
  const scrollMetrics = await menuScroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }))
  expect(compactMetrics.clientHeight).toBeLessThanOrEqual(Math.ceil(compactMetrics.maxHeight))
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)
  await capture('claimed-dark-compact')
})
