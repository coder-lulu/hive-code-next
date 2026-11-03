import { useMemo, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Search, SlidersHorizontal, X } from 'lucide-react-native'
import { PickerModal, type PickerOption } from '../components/PickerModal'
import type { MobileTheme } from '../theme/mobile-theme'
import type { MobileTaskExecutionGroupFilter } from './mobile-task-execution-view'
import {
  createMobileTaskScreenPalette,
  createMobileTaskScreenStyles
} from './mobile-task-screen-styles'

export const MOBILE_TASK_EXECUTION_FILTER_OPTIONS: PickerOption<MobileTaskExecutionGroupFilter>[] =
  [
    {
      value: 'all',
      label: '全部状态',
      subtitle: '显示进行中和最近完成'
    },
    {
      value: 'in-progress',
      label: '进行中',
      subtitle: '运行中、等待确认和受阻任务'
    },
    {
      value: 'recent-completed',
      label: '最近完成',
      subtitle: '当前 Runtime 仍保留的完成记录'
    }
  ]

export function MobileTaskSearchField(props: {
  readonly editable?: boolean
  readonly onBlur?: () => void
  readonly onChangeText: (value: string) => void
  readonly onClear: () => void
  readonly onSubmitEditing?: () => void
  readonly placeholder: string
  readonly showClear: boolean
  readonly theme: MobileTheme
  readonly value: string
}) {
  const [focused, setFocused] = useState(false)
  const styles = useMemo(() => createMobileTaskScreenStyles(props.theme), [props.theme])
  const palette = useMemo(() => createMobileTaskScreenPalette(props.theme), [props.theme])

  return (
    <View style={[styles.searchField, focused && styles.searchFieldFocused]}>
      <Search color={focused ? palette.brand : palette.textSecondary} size={20} strokeWidth={2} />
      <TextInput
        accessibilityLabel={props.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        editable={props.editable}
        maxFontSizeMultiplier={1.3}
        onBlur={() => {
          setFocused(false)
          props.onBlur?.()
        }}
        onChangeText={props.onChangeText}
        onFocus={() => setFocused(true)}
        onSubmitEditing={props.onSubmitEditing}
        placeholder={props.placeholder}
        placeholderTextColor={palette.textTertiary}
        returnKeyType="search"
        selectionColor={palette.brand}
        style={styles.searchInput}
        value={props.value}
      />
      {props.showClear ? (
        <Pressable
          accessibilityLabel="清除搜索"
          accessibilityRole="button"
          onPress={props.onClear}
          style={({ pressed }) => [styles.clearButton, pressed && styles.clearButtonPressed]}
        >
          <X color={palette.textSecondary} size={16} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  )
}

export function MobileRuntimeTaskSearch(props: {
  readonly filter: MobileTaskExecutionGroupFilter
  readonly onChangeText: (value: string) => void
  readonly onFilterChange: (filter: MobileTaskExecutionGroupFilter) => void
  readonly placeholder: string
  readonly theme: MobileTheme
  readonly value: string
}) {
  const [filterPickerVisible, setFilterPickerVisible] = useState(false)
  const styles = useMemo(() => createMobileTaskScreenStyles(props.theme), [props.theme])
  const palette = useMemo(() => createMobileTaskScreenPalette(props.theme), [props.theme])
  const filterActive = props.filter !== 'all'
  const filterLabel =
    MOBILE_TASK_EXECUTION_FILTER_OPTIONS.find((option) => option.value === props.filter)?.label ??
    '全部状态'

  return (
    <>
      <View style={styles.searchBar}>
        <MobileTaskSearchField
          onChangeText={props.onChangeText}
          onClear={() => props.onChangeText('')}
          placeholder={props.placeholder}
          showClear={props.value.length > 0}
          theme={props.theme}
          value={props.value}
        />
        <Pressable
          accessibilityLabel={`筛选任务状态，${filterLabel}`}
          accessibilityRole="button"
          accessibilityState={{ selected: filterActive }}
          onPress={() => setFilterPickerVisible(true)}
          style={({ pressed }) => [
            styles.filterButton,
            styles.filterIconButton,
            filterActive && styles.filterButtonActive,
            pressed && styles.filterButtonPressed
          ]}
        >
          <SlidersHorizontal
            color={filterActive ? palette.brand : palette.textSecondary}
            size={20}
            strokeWidth={2}
          />
        </Pressable>
      </View>
      <PickerModal
        onClose={() => setFilterPickerVisible(false)}
        onSelect={props.onFilterChange}
        options={MOBILE_TASK_EXECUTION_FILTER_OPTIONS}
        selected={props.filter}
        title="筛选任务状态"
        visible={filterPickerVisible}
      />
    </>
  )
}
