import { afterEach, expect, it } from 'vitest'
import { i18n, translate } from './i18n'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

it('localizes the unified board and its view switch for Chinese users', async () => {
  await i18n.changeLanguage('zh')
  expect(translate('workspaceBoard.title', 'Board')).toBe('看板')
  expect(translate('workspaceBoard.workspaces', 'Workspaces')).toBe('工作区')
  expect(translate('workspaceBoard.agents', 'Agents')).toBe('智能体')
  expect(translate('workspaceBoard.openPopout', 'Open in separate window')).toBe('在独立窗口中打开')
})
