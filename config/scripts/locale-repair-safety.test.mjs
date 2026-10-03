import { describe, expect, it } from 'vitest'
import {
  repairCatalog,
  repairTranslatedValue,
  shouldPreserveEnglishValue
} from './locale-translation-policy.mjs'

describe('locale repair safety', () => {
  it.each([
    'auto.components.settings.TerminalWindowSection.c9e1fdf42f',
    'auto.components.onboarding.ThemeStep.ab2a583a97'
  ])('preserves the Chinese screen cursor translation for %s', (key) => {
    expect(shouldPreserveEnglishValue('Cursor', key)).toBe(false)
    expect(
      repairTranslatedValue({ key, enValue: 'Cursor', localeValue: '光标', locale: 'zh' })
    ).toBe('光标')
  })

  it('still preserves the Cursor product name', () => {
    expect(shouldPreserveEnglishValue('Cursor')).toBe(true)
    expect(
      repairTranslatedValue({
        key: 'auto.lib.agent.catalog.cursor',
        enValue: 'Cursor',
        localeValue: '光标',
        locale: 'zh'
      })
    ).toBe('Cursor')
  })

  it('preserves the Chinese Android search keyword', () => {
    expect(
      repairTranslatedValue({
        key: 'auto.components.settings.mobile.settings.search.a7eececc1d',
        enValue: 'android',
        localeValue: '安卓',
        locale: 'zh'
      })
    ).toBe('安卓')
  })

  it.each(['HiveCode', 'HiveCloud'])('preserves the %s product name', (brand) => {
    expect(
      repairTranslatedValue({
        key: 'example.brand',
        enValue: brand,
        localeValue: '蜂巢',
        locale: 'zh'
      })
    ).toBe(brand)
  })

  it('ignores a key override whose placeholders no longer match the source', () => {
    const localeValue = '페이지를 다시 시도하거나 다른 {{value0}} 화면으로 이동하세요.'
    expect(
      repairTranslatedValue({
        key: 'auto.App.03a14f6b5b',
        enValue: 'Retry the page or navigate to another {{value0}} surface.',
        localeValue,
        locale: 'ko'
      })
    ).toBe(localeValue)
  })

  it('preserves the correct Chinese AI agent terminology', () => {
    expect(
      repairTranslatedValue({
        key: 'example.description',
        enValue: 'Manage AI coding agents.',
        localeValue: '管理 AI 编码智能体。',
        locale: 'zh'
      })
    ).toBe('管理 AI 编码智能体。')
  })

  it.each([
    [
      'ko',
      'auto.App.98d4ea2823',
      'Terminal, browser, or editor rendering failed in this workspace. Retry to remount it.',
      '이 워크스페이스에서 터미널, 브라우저 또는 편집기 렌더링에 실패했습니다. 다시 시도해 보세요.'
    ],
    ['ja', 'auto.components.settings.CommitMessageAiPane.4ec89c319e', 'agent', 'エージェント']
  ])('keeps valid generic wording in %s', (locale, key, enValue, localeValue) => {
    expect(repairTranslatedValue({ locale, key, enValue, localeValue })).toBe(localeValue)
  })

  it('does not replace current menu branding after repairing a catalog', () => {
    const english = { menu: { exploreOrca: 'Explore HiveCode', gettingStarted: 'Getting Started' } }
    const chinese = { menu: { exploreOrca: '探索 HiveCode', gettingStarted: '快速入门' } }
    repairCatalog(english, chinese, 'zh')
    expect(chinese).toEqual({ menu: { exploreOrca: '探索 HiveCode', gettingStarted: '快速入门' } })
  })
})
