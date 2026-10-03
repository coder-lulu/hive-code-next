import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.use({ orcaAppExtraEnv: { ORCA_BACKGROUND_LAUNCH: '1' } })

for (const chat of [false, true]) {
  test(`HiveCode floating launch uses a normal terminal with ${chat ? 'Chat UI' : 'TUI'} preference`, async ({
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await orcaPage.evaluate((openChat) => {
      const store = window.__store!
      store.setState({
        settings: {
          ...store.getState().settings!,
          defaultTuiAgent: 'hivecode',
          experimentalNativeChat: true,
          openAgentTabsInChatByDefault: openChat
        }
      })
    }, chat)
    await orcaPage.getByRole('button', { name: 'New task', exact: true }).click()
    const picker = orcaPage.locator('.desktop-home-agent-picker').getByRole('combobox')
    await picker.click()
    await orcaPage.getByRole('option', { name: 'HiveCode AI', exact: true }).click()
    await orcaPage
      .getByRole('textbox', { name: 'Task description', exact: true })
      .fill('native launch routing fixture')
    // The isolated account is signed out: this proves UI routing, not paid inference.
    await orcaPage.getByRole('button', { name: 'Send task', exact: true }).click()
    await expect
      .poll(() =>
        orcaPage.evaluate(() => {
          const state = window.__store!.getState()
          const terminal = Object.values(state.tabsByWorktree)
            .flat()
            .find((tab) => tab.launchAgent === 'hivecode')
          if (!terminal) {
            return null
          }
          const tab = Object.values(state.unifiedTabsByWorktree)
            .flat()
            .find((entry) => entry.entityId === terminal.id)
          return tab
            ? {
                type: tab.contentType,
                viewMode: tab.viewMode ?? 'terminal',
                customSession: tab.entityId.startsWith('ha-session:')
              }
            : null
        })
      )
      .toEqual({ type: 'terminal', viewMode: chat ? 'chat' : 'terminal', customSession: false })
    await expect(orcaPage.getByTestId('session-content-loading')).toHaveCount(0)
    await orcaPage.screenshot({
      path: testInfo.outputPath(`native-launch-${chat ? 'chat' : 'tui'}.png`)
    })
  })
}
