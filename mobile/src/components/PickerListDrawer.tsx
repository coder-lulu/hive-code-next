import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'

import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { BottomDrawer } from './BottomDrawer'

type PickerListItem = { id: string; label: string; detail?: string }

type Props<T extends PickerListItem> = {
  visible: boolean
  title: string
  items: T[]
  selectedId: string
  onSelect: (item: T) => void
  onClose: () => void
  renderIcon?: (item: T) => ReactNode
}

export function PickerListDrawer<T extends PickerListItem>({
  visible,
  title,
  items,
  selectedId,
  onSelect,
  onClose,
  renderIcon
}: Props<T>) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [closing, setClosing] = useState(false)
  const pendingItemRef = useRef<T | null>(null)
  const selectionClosingRef = useRef(false)
  const drawerVisible = visible && !closing

  useEffect(() => {
    pendingItemRef.current = null
    if (visible) {
      selectionClosingRef.current = false
      setClosing(false)
    }
  }, [visible])

  const finishClose = useCallback(() => {
    // Native dismissal can arrive after selection; only the completed hide owns that handoff.
    if (selectionClosingRef.current) {
      return
    }
    onClose()
  }, [onClose])

  const completeSelection = useCallback(() => {
    const item = pendingItemRef.current
    pendingItemRef.current = null
    if (item) {
      onClose()
      onSelect(item)
    }
  }, [onClose, onSelect])

  const closeThenSelect = useCallback((item: T) => {
    if (selectionClosingRef.current) {
      return
    }
    pendingItemRef.current = item
    selectionClosingRef.current = true
    setClosing(true)
  }, [])

  return (
    <BottomDrawer
      visible={drawerVisible}
      onClose={finishClose}
      onAfterClose={completeSelection}
      dragContentToDismiss={false}
      contentScrollable={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.group}
        contentContainerStyle={items.length === 0 ? styles.emptyContent : undefined}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        ItemSeparatorComponent={PickerSeparator}
        renderItem={({ item }) => {
          const selected = item.id === selectedId
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={() => closeThenSelect(item)}
            >
              {renderIcon?.(item)}
              <View style={styles.itemCopy}>
                <Text
                  style={[styles.itemText, selected && styles.itemTextSelected]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
                {item.detail ? (
                  <Text style={styles.itemDetail} numberOfLines={1}>
                    {item.detail}
                  </Text>
                ) : null}
              </View>
              {selected && <Check size={16} color={theme.color.brand.primary} />}
            </Pressable>
          )
        }}
      />
    </BottomDrawer>
  )
}

function PickerSeparator() {
  const styles = useMobileThemeStyles(createStyles)
  return <View style={styles.separator} />
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: theme.spacing.space4,
      paddingBottom: theme.spacing.space12
    },
    title: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    group: {
      backgroundColor: theme.color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      overflow: 'hidden',
      maxHeight: 420,
      flexGrow: 0
    },
    emptyContent: {
      minHeight: theme.spacing.space24
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.color.border.subtle,
      marginHorizontal: theme.spacing.space16
    },
    item: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16
    },
    itemPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    itemText: {
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    itemCopy: {
      flex: 1,
      minWidth: 0
    },
    itemDetail: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    },
    itemTextSelected: {
      fontWeight: '600'
    }
  })
}
