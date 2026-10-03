import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '../../i18n/i18n'
import {
  getAccountsCodexSearchEntries,
  getAccountsMiniMaxSearchEntries,
  getAccountsOpencodeSearchEntries
} from './accounts-search'
import { resolveAccountsPaneNavigation } from './accounts-pane-navigation'
import { matchesSettingsSearch } from './settings-search'

describe('provider account settings search', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('keeps the English Codex Accounts title searchable in a localized UI', async () => {
    await i18n.changeLanguage('zh')

    expect(matchesSettingsSearch('Codex Accounts', getAccountsCodexSearchEntries())).toBe(true)
    expect(getAccountsCodexSearchEntries()[0]?.targetSectionId).toBe('accounts-codex')
    expect(resolveAccountsPaneNavigation('accounts-codex')).toEqual({
      accountSheet: 'codex',
      credentialSheet: null
    })
  })
})

describe('getAccountsMiniMaxSearchEntries', () => {
  it('targets the MiniMax session cookie flow', () => {
    const entries = getAccountsMiniMaxSearchEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.title).toBe('MiniMax Usage')
    expect(entries[0]?.description.toLowerCase()).toContain('cookie')
    expect(entries[0]?.description.toLowerCase()).toContain('api key')
  })
})

describe('getAccountsOpencodeSearchEntries', () => {
  it('tells search to paste the full Cookie header including the console session', () => {
    const cookieEntry = getAccountsOpencodeSearchEntries().find(
      (entry) => entry.title === 'OpenCode Go Session Cookie'
    )

    expect(cookieEntry).toBeDefined()
    expect(cookieEntry?.description).toContain('__Host-console_session')
    expect(cookieEntry?.description).toContain('Cookie header')
    expect(cookieEntry?.description).not.toMatch(/Fe26\.2\*\*/)
    expect(cookieEntry?.keywords).toEqual(
      expect.arrayContaining(['opencode', 'cookie', 'session', 'console', 'rate limit'])
    )
  })
})
