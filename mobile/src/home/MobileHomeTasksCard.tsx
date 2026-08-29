import { ChevronRight, ListTodo } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { TaskProviderLogo } from '../components/TaskProviderLogo'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/mobile-theme-provider'

const TASK_PROVIDER_LABELS: Record<TaskProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear'
}

export function MobileHomeTasksCard(props: {
  enabled: boolean
  providers: TaskProvider[]
  onOpen: (provider?: TaskProvider) => void
}) {
  const theme = useMobileTheme()
  const styles = createStyles(theme)
  return (
    <Pressable
      disabled={!props.enabled}
      style={({ pressed }) => [
        styles.card,
        !props.enabled && styles.cardDisabled,
        pressed && styles.cardPressed
      ]}
      onPress={() => props.onOpen()}
    >
      <View style={styles.icon}>
        <ListTodo size={18} color={theme.color.text.secondary} />
      </View>
      <View style={styles.main}>
        <Text style={styles.title}>任务中心</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {props.providers.length > 0
            ? props.providers.map((provider) => TASK_PROVIDER_LABELS[provider]).join(' · ')
            : '未连接任务来源'}
        </Text>
      </View>
      <View style={styles.trailing}>
        <View
          style={styles.providerRow}
          accessibilityLabel={props.providers
            .map((provider) => TASK_PROVIDER_LABELS[provider])
            .join(', ')}
        >
          {props.providers.map((provider) => (
            <Pressable
              key={provider}
              accessibilityRole="button"
              accessibilityLabel={`Open ${TASK_PROVIDER_LABELS[provider]} tasks`}
              hitSlop={8}
              style={({ pressed }) => [
                styles.providerButton,
                pressed && styles.providerButtonPressed
              ]}
              onPress={(event) => {
                event.stopPropagation()
                props.onOpen(provider)
              }}
            >
              <TaskProviderLogo provider={provider} size={22} color={theme.color.text.secondary} />
            </Pressable>
          ))}
        </View>
      </View>
      <ChevronRight size={16} color={theme.color.text.tertiary} />
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 72,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    cardDisabled: { opacity: 0.45 },
    cardPressed: { backgroundColor: theme.color.bg.subtle },
    icon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    main: { flex: 1, minWidth: 0 },
    title: { ...theme.typography.label, fontWeight: '600', color: theme.color.text.primary },
    subtitle: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: theme.color.text.secondary
    },
    trailing: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
      marginLeft: theme.spacing.space8
    },
    providerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: theme.spacing.space4
    },
    providerButton: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    providerButtonPressed: { backgroundColor: theme.color.bg.subtle }
  })
}
