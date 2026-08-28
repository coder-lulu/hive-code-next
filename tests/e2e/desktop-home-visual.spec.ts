import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { APP_DISPLAY_NAME } from '../../src/shared/brand'

test.use({ seedTestRepo: false, dismissOnboarding: true })

test('desktop home renders the production shell and empty states', async ({ orcaPage }) => {
  await orcaPage.waitForFunction(
    () => Boolean(window.__store?.getState().workspaceSessionReady),
    undefined,
    { timeout: 30_000 }
  )
  await orcaPage.evaluate(() => {
    window.__store?.setState({
      activeView: 'terminal',
      activeWorktreeId: null,
      rightSidebarOpen: true
    })
  })

  const home = orcaPage.getByTestId('desktop-home')
  await expect(home).toBeVisible()
  await expect(
    home.getByRole('heading', { name: `${APP_DISPLAY_NAME}，开始今天的开发工作` })
  ).toBeVisible()
  await expect(home.getByRole('button', { name: '添加项目' })).toBeVisible()

  await orcaPage.screenshot({
    path: path.resolve('.omx/state/desktop-home/iteration-2.png'),
    animations: 'disabled'
  })
})
