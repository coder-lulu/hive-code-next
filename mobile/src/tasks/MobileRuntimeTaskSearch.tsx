import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { translate } from '../i18n/mobile-i18n'
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
      get label() {
        return translate('auto.mobile.src.tasks.MobileRuntimeTaskSearch.c0c316a1e7', 'All statuses')
      },
      get subtitle() {
        return translate(
          'auto.mobile.src.tasks.MobileRuntimeTaskSearch.261c12b64d',
          'Show in-progress and recently completed tasks'
        )
      }
    },
    {
      value: 'in-progress',
      get label() {
        return translate('worktree.workspaceListSections.inProgress', 'In progress')
      },
      get subtitle() {
        return translate(
          'auto.mobile.src.tasks.MobileRuntimeTaskSearch.bd6a1db208',
          'Running, awaiting confirmation, and blocked tasks'
        )
      }
    },
    {
      value: 'recent-completed',
      get label() {
        return translate(
          'auto.mobile.src.tasks.MobileRuntimeTaskSearch.f2f1795ca4',
          'Recently completed'
        )
      },
      get subtitle() {
        return translate(
          'auto.mobile.src.tasks.MobileRuntimeTaskSearch.b4538deabc',
          'Completed records retained by the current Runtime'
        )
      }
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
  const t = useMobileTranslation()

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
          accessibilityLabel={t('components.searchField.clearSearch', 'Clear search')}
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
  const t = useMobileTranslation()

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
          accessibilityLabel={t(
            'auto.mobile.src.tasks.MobileRuntimeTaskSearch.e9dd56c1ca',
            'Filter task status, {{value0}}',
            { value0: filterLabel }
          )}
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
        title={t('auto.mobile.src.tasks.MobileRuntimeTaskSearch.88fe858446', 'Filter task status')}
        visible={filterPickerVisible}
      />
    </>
  )
}
