import { normalizeSourceControlAiActionDefaults } from '../../../shared/source-control-ai-actions'
import { migrateActionPermissionArgs } from '../../../shared/source-control-action-permission-lift'
import { homedir } from 'node:os'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { getDefaultPersistedState } from '../../../shared/constants'
import { normalizeWorktreeVisibilityDefaults } from '../../../shared/external-worktree-visibility'
import {
  legacyTerminalScrollbackBytesToRows,
  normalizeDesktopTerminalScrollbackRows
} from '../../../shared/terminal-scrollback-policy'
import { normalizeSourceControlAiSettings } from '../../../shared/source-control-ai'
import { normalizeFloatingWorkspaceTrustedCwds } from '../restoring-sessions/floating-workspace-normalization'

export function prepareLoadedTerminalSettings(parsed: PersistedState, markNeedsSave: () => void) {
  const defaults = getDefaultPersistedState(homedir())
  const trusted = normalizeFloatingWorkspaceTrustedCwds(
    parsed.settings?.floatingTerminalTrustedCwds,
    homedir()
  )
  if (trusted.changed) {
    markNeedsSave()
  }
  const rawSettings = parsed.settings
  const legacyBytes =
    rawSettings && 'terminalScrollbackBytes' in rawSettings
      ? rawSettings.terminalScrollbackBytes
      : undefined
  const scrollbackRows =
    rawSettings?.terminalScrollbackRows === undefined
      ? legacyTerminalScrollbackBytesToRows(legacyBytes)
      : normalizeDesktopTerminalScrollbackRows(rawSettings.terminalScrollbackRows)
  if (legacyBytes !== undefined) {
    markNeedsSave()
  }
  const rawSource = parsed.settings?.sourceControlAi
  const legacyActions =
    rawSource && 'launchActionDefaults' in rawSource
      ? normalizeSourceControlAiActionDefaults(rawSource.launchActionDefaults)
      : undefined
  const sourceActions = { ...legacyActions, ...rawSource?.actions }
  if (legacyActions) {
    markNeedsSave()
  }
  const actions = migrateActionPermissionArgs(sourceActions)
  if (actions !== sourceActions) {
    markNeedsSave()
  }
  const repos = (Array.isArray(parsed.repos) ? parsed.repos : []).map((repo) => {
    const actionOverrides = migrateActionPermissionArgs(repo.sourceControlAi?.actionOverrides)
    if (actionOverrides === repo.sourceControlAi?.actionOverrides) {
      return repo
    }
    markNeedsSave()
    return { ...repo, sourceControlAi: { ...repo.sourceControlAi, actionOverrides } }
  })
  return {
    defaults,
    repos,
    settings: {
      worktreeVisibilityDefaults:
        normalizeWorktreeVisibilityDefaults(parsed.settings?.worktreeVisibilityDefaults) ??
        defaults.settings.worktreeVisibilityDefaults,
      terminalScrollbackRows: scrollbackRows,
      sourceControlAi: normalizeSourceControlAiSettings(
        rawSource ? { ...rawSource, actions } : undefined
      ),
      floatingTerminalTrustedCwds: trusted.trustedCwds
    }
  }
}

export type PreparedLoadedTerminalSettings = ReturnType<typeof prepareLoadedTerminalSettings>
