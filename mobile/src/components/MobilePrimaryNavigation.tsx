import { Bot, BookOpen, FolderKanban, ListTodo, Workflow } from 'lucide-react-native'
import type { ComponentType } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export type MobilePrimaryDestination = 'tasks' | 'agents' | 'library' | 'automation' | 'workspace'

type NavigationItem = {
  readonly id: MobilePrimaryDestination
  readonly label: string
  readonly Icon: ComponentType<{ color?: string; size?: number; strokeWidth?: number }>
}

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { id: 'tasks', label: '任务', Icon: ListTodo },
  { id: 'agents', label: '智能体', Icon: Bot },
  { id: 'library', label: '资料库', Icon: BookOpen },
  { id: 'automation', label: '自动化', Icon: Workflow },
  { id: 'workspace', label: '工作区', Icon: FolderKanban }
]

export function MobilePrimaryNavigation(props: {
  readonly active: MobilePrimaryDestination
  readonly bottomInset: number
  readonly onSelect: (destination: MobilePrimaryDestination) => void
  readonly theme: MobileTheme
}) {
  const styles = createStyles(props.theme, props.bottomInset)
  return (
    <View accessibilityRole="tablist" style={styles.navigation}>
      {NAVIGATION_ITEMS.map(({ id, label, Icon }) => {
        const selected = id === props.active
        const color = selected ? props.theme.color.brand.primary : props.theme.color.text.secondary
        return (
          <Pressable
            key={id}
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => props.onSelect(id)}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
          >
            <View style={[styles.indicator, selected && styles.indicatorSelected]} />
            <Icon color={color} size={22} strokeWidth={selected ? 2.1 : 1.9} />
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={[styles.label, selected && styles.labelSelected]}
            >
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function createStyles(theme: MobileTheme, bottomInset: number) {
  return StyleSheet.create({
    navigation: {
      minHeight: theme.size.primaryNavigationHeight + bottomInset,
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingBottom: bottomInset,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    item: {
      minWidth: 0,
      minHeight: 56,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space4
    },
    itemPressed: { backgroundColor: theme.color.bg.subtle },
    indicator: {
      position: 'absolute',
      top: 0,
      width: theme.spacing.space24,
      height: theme.size.activeIndicatorHeight,
      borderRadius: theme.radii.small,
      backgroundColor: 'transparent'
    },
    indicatorSelected: { backgroundColor: theme.color.brand.primary },
    label: { ...theme.typography.caption, color: theme.color.text.secondary },
    labelSelected: { color: theme.color.brand.primary, fontWeight: '600' }
  })
}
