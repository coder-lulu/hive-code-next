import { useState } from 'react'
import {
  getAccountsClaudeSearchEntries,
  getAccountsCodexSearchEntries,
  getAccountsMiniMaxSearchEntries,
  getAccountsOpencodeSearchEntries
} from './accounts-search'
import { resolveAccountsPaneNavigation } from './accounts-pane-navigation'
import type { AccountsPaneNavigation } from './accounts-pane-navigation'
import type { CredentialSheetKind } from './accounts-pane-credentials-overview'
import type { ProviderAccountSheetKind } from './accounts-pane-provider-sheet'
import { matchesSettingsSearch } from './settings-search'

type NavigationState = AccountsPaneNavigation & {
  accountScopeKey: string
  navigationTargetSectionId: string | null
  normalizedSearchQuery: string
}

function resolveUniqueSearchNavigation(searchQuery: string): AccountsPaneNavigation | null {
  const targets = [
    matchesSettingsSearch(searchQuery, getAccountsClaudeSearchEntries()) ? 'claude' : null,
    matchesSettingsSearch(searchQuery, getAccountsCodexSearchEntries()) ? 'codex' : null,
    matchesSettingsSearch(searchQuery, getAccountsOpencodeSearchEntries()) ? 'opencode' : null,
    matchesSettingsSearch(searchQuery, getAccountsMiniMaxSearchEntries()) ? 'minimax' : null
  ].filter(Boolean)
  if (targets.length !== 1) {
    return null
  }
  const target = targets[0]
  return target === 'claude' || target === 'codex'
    ? { accountSheet: target, credentialSheet: null }
    : { accountSheet: null, credentialSheet: target as CredentialSheetKind }
}

export function useAccountsPaneNavigation({
  accountScopeKey,
  navigationTargetSectionId,
  searchQuery
}: {
  accountScopeKey: string
  navigationTargetSectionId: string | null
  searchQuery: string
}) {
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()
  const [navigationState, setNavigationState] = useState<NavigationState>(() => ({
    ...(normalizedSearchQuery
      ? (resolveUniqueSearchNavigation(searchQuery) ??
        resolveAccountsPaneNavigation(navigationTargetSectionId))
      : resolveAccountsPaneNavigation(navigationTargetSectionId)),
    accountScopeKey,
    navigationTargetSectionId,
    normalizedSearchQuery
  }))

  let visibleNavigation = navigationState
  if (
    navigationState.accountScopeKey !== accountScopeKey ||
    navigationState.navigationTargetSectionId !== navigationTargetSectionId ||
    navigationState.normalizedSearchQuery !== normalizedSearchQuery
  ) {
    const next = {
      ...navigationState,
      accountScopeKey,
      navigationTargetSectionId,
      normalizedSearchQuery
    }
    if (navigationState.accountScopeKey !== accountScopeKey) {
      next.accountSheet = null
    }
    if (navigationState.navigationTargetSectionId !== navigationTargetSectionId) {
      const target = resolveAccountsPaneNavigation(navigationTargetSectionId)
      if (target.accountSheet || target.credentialSheet) {
        next.accountSheet = target.accountSheet
        next.credentialSheet = target.credentialSheet
      }
    }
    if (navigationState.normalizedSearchQuery !== normalizedSearchQuery && normalizedSearchQuery) {
      const target = resolveUniqueSearchNavigation(searchQuery)
      if (target) {
        next.accountSheet = target.accountSheet
        next.credentialSheet = target.credentialSheet
      }
    }
    // Adjust during render so the old owner's sheet is never painted for the new owner.
    setNavigationState(next)
    visibleNavigation = next
  }

  const setAccountSheet = (sheet: ProviderAccountSheetKind | null): void => {
    setNavigationState((current) => ({ ...current, accountSheet: sheet }))
  }
  const setCredentialSheet = (sheet: CredentialSheetKind | null): void => {
    setNavigationState((current) => ({ ...current, credentialSheet: sheet }))
  }

  return {
    accountSheet: visibleNavigation.accountSheet,
    credentialSheet: visibleNavigation.credentialSheet,
    setAccountSheet,
    setCredentialSheet
  }
}
