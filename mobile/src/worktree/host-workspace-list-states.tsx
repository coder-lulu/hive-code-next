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
        <Text style={styles.emptyText}>无法从这台电脑加载工作区</Text>
        <Text style={styles.catalogErrorDetail}>
          {`工作区读取失败（${props.catalogError}），正在自动重试`}
        </Text>
      </View>
    )
  }
  if (state === 'empty') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>
          {props.search
            ? '没有匹配的工作区'
            : props.activeFilterCount > 0
              ? '没有符合筛选条件的工作区'
              : '暂无工作区'}
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
