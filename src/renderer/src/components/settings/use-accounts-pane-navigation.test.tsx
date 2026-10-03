// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAccountsPaneNavigation } from './use-accounts-pane-navigation'

afterEach(cleanup)

describe('accounts pane navigation', () => {
  it('shows a new navigation target on its first render and keeps a manually closed sheet closed', () => {
    const renderedSheets: (string | null)[] = []
    const view = renderHook(
      ({ navigationTargetSectionId }) => {
        const navigation = useAccountsPaneNavigation({
          accountScopeKey: 'local:host:',
          navigationTargetSectionId,
          searchQuery: ''
        })
        renderedSheets.push(navigation.accountSheet)
        return navigation
      },
      { initialProps: { navigationTargetSectionId: 'accounts-claude' } }
    )

    act(() => view.result.current.setAccountSheet(null))
    renderedSheets.length = 0
    view.rerender({ navigationTargetSectionId: 'accounts-codex' })
    expect(renderedSheets[0]).toBe('codex')
    expect(view.result.current.accountSheet).toBe('codex')

    act(() => view.result.current.setAccountSheet(null))
    view.rerender({ navigationTargetSectionId: 'accounts-codex' })
    expect(view.result.current.accountSheet).toBeNull()
  })

  it('closes the account sheet on the first render of a new account owner', () => {
    const renderedSheets: (string | null)[] = []
    const view = renderHook(
      ({ accountScopeKey }) => {
        const navigation = useAccountsPaneNavigation({
          accountScopeKey,
          navigationTargetSectionId: null,
          searchQuery: ''
        })
        renderedSheets.push(navigation.accountSheet)
        return navigation
      },
      { initialProps: { accountScopeKey: 'local:host:' } }
    )
    act(() => view.result.current.setAccountSheet('claude'))
    renderedSheets.length = 0
    view.rerender({ accountScopeKey: 'environment:remote:host:' })
    expect(renderedSheets[0]).toBeNull()
    expect(view.result.current.accountSheet).toBeNull()
  })

  it('opens a unique search target immediately and lets the user close it until the query changes', () => {
    const renderedSheets: (string | null)[] = []
    const view = renderHook(
      ({ searchQuery }) => {
        const navigation = useAccountsPaneNavigation({
          accountScopeKey: 'local:host:',
          navigationTargetSectionId: null,
          searchQuery
        })
        renderedSheets.push(navigation.accountSheet)
        return navigation
      },
      { initialProps: { searchQuery: '' } }
    )
    renderedSheets.length = 0
    view.rerender({ searchQuery: 'claude' })
    expect(renderedSheets[0]).toBe('claude')
    act(() => view.result.current.setAccountSheet(null))
    view.rerender({ searchQuery: 'claude' })
    expect(view.result.current.accountSheet).toBeNull()

    view.rerender({ searchQuery: '' })
    view.rerender({ searchQuery: 'claude' })
    expect(view.result.current.accountSheet).toBe('claude')
  })
})
