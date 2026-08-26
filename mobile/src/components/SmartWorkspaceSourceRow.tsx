import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CaseSensitive, GitBranch, Sparkles } from 'lucide-react-native'
import type { SmartWorkspaceSourceRow as SourceRow } from '../../../src/shared/new-workspace/smart-workspace-source-results'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { TaskProviderLogo } from './TaskProviderLogo'

type Props = {
  row: SourceRow
  onPress: () => void
}

type RowContent = {
  icon: React.ReactNode
  title: string
  subtitle?: string
  status?: string
}

function resolveRowContent(row: SourceRow, theme: MobileTheme): RowContent {
  switch (row.kind) {
    case 'use-name':
      return {
        icon: <Sparkles size={16} color={theme.color.text.secondary} />,
        title: `Use "${row.name}"`,
        subtitle: 'Name this workspace'
      }
    case 'create-branch':
      return {
        icon: <GitBranch size={16} color={theme.color.brand.primary} />,
        title: `Create branch "${row.name}"`,
        subtitle: 'New branch'
      }
    case 'github':
      return {
        icon: <TaskProviderLogo provider="github" size={16} color={theme.color.text.secondary} />,
        title: row.item.title,
        subtitle: `${row.item.type === 'pr' ? 'PR #' : 'Issue #'}${row.item.number}`,
        status: row.item.state
      }
    case 'gitlab':
      return {
        icon: <TaskProviderLogo provider="gitlab" size={16} color={theme.color.text.secondary} />,
        title: row.item.title,
        subtitle: `${row.item.type === 'mr' ? 'MR !' : 'Issue #'}${row.item.number}`,
        status: row.item.state
      }
    case 'branch':
      return {
        icon: <GitBranch size={16} color={theme.color.text.secondary} />,
        title: row.localBranchName || row.refName,
        subtitle: row.refName
      }
    case 'linear':
      return {
        icon: <TaskProviderLogo provider="linear" size={16} color={theme.color.text.secondary} />,
        title: row.issue.title,
        subtitle: `${row.issue.identifier} · ${row.issue.team?.key ?? 'Linear'}`,
        status: row.issue.state?.name
      }
    default:
      return {
        icon: <CaseSensitive size={16} color={theme.color.text.secondary} />,
        title: ''
      }
  }
}

export function SmartWorkspaceSourceRow({ row, onPress }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const content = resolveRowContent(row, theme)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={content.title}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.icon}>{content.icon}</View>
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {content.title}
        </Text>
        {content.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {content.subtitle}
          </Text>
        ) : null}
      </View>
      {content.status ? (
        <View style={styles.pill}>
          <Text style={styles.pillText} numberOfLines={1}>
            {content.status}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    row: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16
    },
    rowPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    icon: {
      width: 20,
      alignItems: 'center'
    },
    copy: {
      flex: 1,
      minWidth: 0
    },
    title: {
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    subtitle: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    },
    pill: {
      backgroundColor: theme.color.bg.subtle,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4
    },
    pillText: {
      ...theme.typography.caption,
      fontWeight: '600',
      color: theme.color.text.secondary,
      textTransform: 'capitalize'
    }
  })
}
