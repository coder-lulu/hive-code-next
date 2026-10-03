import type { CredentialSheetKind } from './accounts-pane-credentials-overview'
import type { ProviderAccountSheetKind } from './accounts-pane-provider-sheet'

export type AccountsPaneNavigation = {
  accountSheet: ProviderAccountSheetKind | null
  credentialSheet: CredentialSheetKind | null
}

export function resolveAccountsPaneNavigation(sectionId?: string | null): AccountsPaneNavigation {
  if (sectionId === 'accounts-claude' || sectionId === 'accounts-codex') {
    return {
      accountSheet: sectionId === 'accounts-claude' ? 'claude' : 'codex',
      credentialSheet: null
    }
  }
  if (sectionId === 'accounts-opencode-go' || sectionId === 'accounts-minimax') {
    return {
      accountSheet: null,
      credentialSheet: sectionId === 'accounts-opencode-go' ? 'opencode' : 'minimax'
    }
  }
  return { accountSheet: null, credentialSheet: null }
}
