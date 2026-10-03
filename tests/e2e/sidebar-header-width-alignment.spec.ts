import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test('open sidebar header follows the list width at its minimum and during a resize', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSidebarOpen(true)
    state.setSidebarWidth(220)
    state.openSessionsPage()
    state.updateSessionsView({ navigation: 'projects' })
  })

  const measureEdges = () =>
    orcaPage.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(
        '[data-sidebar-resize-handle]'
      )?.parentElement
      const header = document.querySelector<HTMLElement>('.titlebar-left')
      if (!sidebar || !header) {
        return null
      }
      return {
        sidebarRight: sidebar.getBoundingClientRect().right,
        headerRight: header.getBoundingClientRect().right
      }
    })

  await expect.poll(measureEdges).toMatchObject({ sidebarRight: 220, headerRight: 220 })

  const handle = orcaPage.locator('[data-sidebar-resize-handle]')
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const startX = box!.x + box!.width / 4
  const startY = box!.y + box!.height / 2
  await orcaPage.mouse.move(startX, startY)
  await orcaPage.mouse.down()
  expect(await orcaPage.evaluate(() => document.body.style.cursor)).toBe('col-resize')
  await orcaPage.mouse.move(startX + 60, startY)

  await expect.poll(measureEdges).toMatchObject({ sidebarRight: 280, headerRight: 280 })

  await orcaPage.mouse.up()
  await expect.poll(measureEdges).toMatchObject({ sidebarRight: 280, headerRight: 280 })
})
