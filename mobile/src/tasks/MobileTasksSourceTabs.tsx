import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text } from 'react-native'
import { Code2, ListTodo } from 'lucide-react-native'
import { PickerModal, type PickerOption } from '../components/PickerModal'
import { TaskProviderLogo } from '../components/TaskProviderLogo'
import { colors, type MobileTheme } from '../theme/mobile-theme'
import type { TaskProvider } from './mobile-task-providers'
import {
  createMobileTaskScreenPalette,
  createMobileTaskScreenStyles
} from './mobile-task-screen-styles'

export type MobileTasksSourceView = 'all' | 'local' | 'hosted'

export const MOBILE_TASK_PROVIDER_OPTIONS: PickerOption<TaskProvider>[] = [
  {
    value: 'github',
    label: 'GitHub',
    subtitle: 'Issues and pull requests',
    renderIcon: (selected) => (
      <TaskProviderLogo
        provider="github"
        size={16}
        color={selected ? colors.textPrimary : colors.textSecondary}
      />
    )
  },
  {
    value: 'gitlab',
    label: 'GitLab',
    subtitle: 'Issues and merge requests',
    renderIcon: (selected) => (
      <TaskProviderLogo
        provider="gitlab"
        size={16}
        color={selected ? colors.textPrimary : colors.textSecondary}
      />
    )
  },
  {
    value: 'linear',
    label: 'Linear',
    subtitle: 'Assigned and team issues',
    renderIcon: (selected) => (
      <TaskProviderLogo
        provider="linear"
        size={16}
        color={selected ? colors.textPrimary : colors.textSecondary}
      />
    )
  }
]

type SourceTabProps = {
  disabled?: boolean
  icon: ReactNode
  label: string
  onLongPress?: () => void
  onPress: () => void
  selected: boolean
  styles: ReturnType<typeof createMobileTaskScreenStyles>
}

function SourceTab({
  disabled = false,
  icon,
  label,
  onLongPress,
  onPress,
  selected,
  styles
}: SourceTabProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.providerTab,
        selected && styles.providerTabSelected,
        pressed && styles.providerTabPressed
      ]}
    >
      {icon}
      <Text
        maxFontSizeMultiplier={1.3}
        style={[styles.providerTabText, selected && styles.providerTabTextSelected]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function MobileTasksSourceTabs({
  onOpenProviderPicker,
  onCloseProviderPicker,
  onSelectProvider,
  onSelectView,
  provider,
  providerPickerVisible,
  taskUiReady,
  theme,
  view,
  visibleProviders
}: {
  onCloseProviderPicker: () => void
  onOpenProviderPicker: () => void
  onSelectProvider: (provider: TaskProvider) => void
  onSelectView: (view: 'all' | 'local') => void
  provider: TaskProvider
  providerPickerVisible: boolean
  taskUiReady: boolean
  theme: MobileTheme
  view: MobileTasksSourceView
  visibleProviders: readonly TaskProvider[]
}) {
  const palette = createMobileTaskScreenPalette(theme)
  const styles = createMobileTaskScreenStyles(theme)
  const allSelected = view === 'all'
  const localSelected = view === 'local'
  const providerOptions = MOBILE_TASK_PROVIDER_OPTIONS.filter((option) =>
    visibleProviders.includes(option.value)
  )

  return (
    <>
      <ScrollView
        accessibilityRole="tablist"
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.providerTabsScroll}
        contentContainerStyle={styles.providerTabs}
      >
        <SourceTab
          icon={
            <ListTodo size={16} color={allSelected ? palette.textPrimary : palette.textSecondary} />
          }
          label="全部"
          onPress={() => onSelectView('all')}
          selected={allSelected}
          styles={styles}
        />
        <SourceTab
          icon={
            <Code2 size={16} color={localSelected ? palette.textPrimary : palette.textSecondary} />
          }
          label="本地"
          onPress={() => onSelectView('local')}
          selected={localSelected}
          styles={styles}
        />
        {providerOptions.map((option) => {
          const selected = view === 'hosted' && option.value === provider
          return (
            <SourceTab
              key={option.value}
              disabled={!taskUiReady}
              icon={
                <TaskProviderLogo
                  provider={option.value}
                  size={16}
                  color={selected ? palette.textPrimary : palette.textSecondary}
                />
              }
              label={option.label}
              onLongPress={onOpenProviderPicker}
              onPress={() => onSelectProvider(option.value)}
              selected={selected}
              styles={styles}
            />
          )
        })}
      </ScrollView>
      <PickerModal
        visible={taskUiReady && providerPickerVisible}
        title="任务来源"
        options={providerOptions}
        selected={provider}
        onSelect={onSelectProvider}
        onClose={onCloseProviderPicker}
      />
    </>
  )
}
