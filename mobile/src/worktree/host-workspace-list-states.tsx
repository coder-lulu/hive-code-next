import { useMobileTheme } from '../theme/mobile-theme-provider'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import {
  selectHostWorkspaceListState,
  type HostWorkspaceListStateInput
} from './host-workspace-list-state'

export function HostWorkspaceListStates(
  props: HostWorkspaceListStateInput & {
    theme: MobileTheme
    search: string
    activeFilterCount: number
  }
) {
  const t = useMobileTranslation()

  const styles = createStyles(props.theme)
  const state = selectHostWorkspaceListState(props)
  if (state === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color={props.theme.color.text.secondary} />
      </View>
    )
  }
  if (state === 'catalog-error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>
          {t(
            'auto.mobile.src.worktree.host.workspace.list.states.3299cc29a3',
            'Could not load workspaces from this computer'
          )}
        </Text>
        <Text style={styles.catalogErrorDetail}>
          {t(
            'auto.mobile.src.worktree.host.workspace.list.states.697335f104',
            'Could not read workspaces ({{value0}}). Retrying automatically.',
            { value0: props.catalogError }
          )}
        </Text>
      </View>
    )
  }
  if (state === 'empty') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>
          {props.search
            ? t('worktree.hostWorkspaceListStates.noMatches', 'No matching workspaces')
            : props.activeFilterCount > 0
              ? t(
                  'auto.mobile.src.worktree.host.workspace.list.states.7c5045978d',
                  'No workspaces match the filter'
                )
              : t(
                  'auto.mobile.src.worktree.host.workspace.list.states.f57eb78614',
                  'No workspaces yet'
                )}
        </Text>
      </View>
    )
  }
  return null
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space20
    },
    emptyText: { ...theme.typography.body, color: theme.color.text.secondary },
    catalogErrorDetail: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: theme.color.text.tertiary,
      textAlign: 'center'
    }
  })
}

export function HostWorkspaceListReopen({ aboveRows }: { aboveRows: boolean }) {
  const theme = useMobileTheme()
  const styles = createStyles(theme)
  const t = useMobileTranslation()
  return (
    <View
      style={
        aboveRows
          ? { alignItems: 'center', paddingVertical: theme.spacing.space16 }
          : styles.centered
      }
    >
      <Text style={styles.emptyText}>
        {t('worktree.hostWorkspaceListStates.reopen', 'Reopen to update')}
      </Text>
      <Text style={styles.catalogErrorDetail}>
        {t(
          'worktree.hostWorkspaceListStates.reopenDetail',
          'This host lists workspaces in a way this page does not know yet.'
        )}
      </Text>
    </View>
  )
}
