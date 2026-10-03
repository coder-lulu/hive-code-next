import { afterEach, describe, expect, it } from 'vitest'
import { setRendererUiLanguage } from '@/i18n/i18n'
import {
  getLocalizedExecutionHostLabel,
  getLocalizedLocalExecutionHostLabel
} from './localized-execution-host-label'

afterEach(async () => {
  await setRendererUiLanguage('en')
})

describe('localized execution host labels', () => {
  it('keeps platform-specific English labels', async () => {
    await setRendererUiLanguage('en')
    expect(getLocalizedLocalExecutionHostLabel('win32')).toBe('Local Windows')
    expect(getLocalizedLocalExecutionHostLabel('darwin')).toBe('Local Mac')
    expect(getLocalizedLocalExecutionHostLabel('linux')).toBe('Local Linux')
  })

  it('shows 本机 for the local host in Chinese without translating remote names', async () => {
    await setRendererUiLanguage('zh')
    expect(getLocalizedLocalExecutionHostLabel('win32')).toBe('本机')
    expect(getLocalizedLocalExecutionHostLabel('darwin')).toBe('本机')
    expect(getLocalizedExecutionHostLabel('local')).toBe('本机')
    expect(getLocalizedLocalExecutionHostLabel('win32', 'en')).toBe('Local Windows')
    expect(getLocalizedExecutionHostLabel('ssh:Build%20Server')).toBe('Build Server')
  })

  it.each([
    ['ja', 'ローカル Windows'],
    ['ko', '로컬 Windows'],
    ['es', 'Windows local'],
    ['fr', 'Windows local']
  ] as const)('translates local Windows in %s', async (language, expected) => {
    await setRendererUiLanguage(language)
    expect(getLocalizedLocalExecutionHostLabel('win32')).toBe(expected)
  })
})
