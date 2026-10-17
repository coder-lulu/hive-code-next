import { StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'

type Props = {
  assignee?: string
  priorityName?: string
  projectName: string
}

// The detail sheet owns the surrounding metadata grid.
export function JiraDetailMeta({ assignee, priorityName, projectName }: Props) {
  const styles = useMobileThemeStyles(createStyles)
  const rows: [string, string | undefined][] = [
    ['Assignee', assignee],
    ['Priority', priorityName],
    ['Project', projectName]
  ]
  return (
    <>
      {rows.map(([label, value]) =>
        value ? (
          <View key={label} style={styles.item}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ) : null
      )}
    </>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    item: { minWidth: 96, flexGrow: 1 },
    label: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginBottom: theme.spacing.space4
    },
    value: { ...theme.typography.meta, color: theme.color.text.primary, fontWeight: '600' }
  })
}
