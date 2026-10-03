import { afterEach, expect, it, vi } from 'vitest'
import type { BackendModule } from 'i18next'
import { UI_LANGUAGE_CHINESE, UI_LANGUAGE_ENGLISH } from '../../shared/ui-language'

vi.mock('electron', () => ({ app: { getLocale: () => 'en-US' } }))

import { ensureMainI18n, mainI18n, setMainUiLanguage, translateMain } from './main-i18n'

afterEach(() => vi.restoreAllMocks())

it('keeps the latest English choice when an earlier Chinese catalog finishes loading', async () => {
  await ensureMainI18n()
  const backend: BackendModule = mainI18n.services.backendConnector.backend
  const read = backend.read.bind(backend)
  let finishChinese = (): void => {}
  let markStarted = (): void => {}
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  vi.spyOn(backend, 'read').mockImplementation((language, namespace, callback) => {
    if (language !== 'zh') {
      read(language, namespace, callback)
      return
    }
    finishChinese = () => callback(null, { menu: { file: '文件' } })
    markStarted()
  })

  const earlier = setMainUiLanguage(UI_LANGUAGE_CHINESE)
  await started
  await setMainUiLanguage(UI_LANGUAGE_ENGLISH)
  finishChinese()
  await earlier

  expect(mainI18n.language).toBe('en')
  expect(translateMain('menu.file', 'File')).toBe('File')
})
