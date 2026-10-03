import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, StyleSheet, Switch, Text, View, type AppStateStatus } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { ChevronRight, X } from 'lucide-react-native'
import type Animated from 'react-native-reanimated'
import type { AnimatedRef, SharedValue } from 'react-native-reanimated'
import { CustomKeyModal, loadCustomKeys, saveCustomKeys, type CustomKey } from './CustomKeyModal'
import { DragReorderList } from './DragReorderList'
import { MobileGroupedList, MobileGroupedListRow, MobileIconButton } from './ui'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import {
  TERMINAL_ACCESSORY_KEYS,
  type TerminalAccessoryKey
} from '../terminal/terminal-accessory-keys'
import {
  getDefaultTerminalAccessoryLayout,
  loadTerminalAccessoryLayout,
  reorderTerminalAccessoryBuiltInIds,
  saveTerminalAccessoryLayout,
  setTerminalAccessoryBuiltInVisible,
  type TerminalAccessoryLayout
} from '../terminal/terminal-accessory-layout'

// Why: DragReorderList absolutely positions rows, so every row in a
// reorderable section must share one fixed height.
const REORDER_ROW_HEIGHT = 56

function ShortcutBarRow({
  shortcutKey,
  visible,
  onToggle
}: {
  shortcutKey: TerminalAccessoryKey
  visible: boolean
  onToggle: (visible: boolean) => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const keyName = shortcutKey.accessibilityLabel ?? shortcutKey.label

  return (
    <View style={styles.reorderRowContent}>
      <View style={styles.keycap}>
        <Text maxFontSizeMultiplier={1.3} style={styles.keycapText}>
          {shortcutKey.label}
        </Text>
      </View>
      <View style={styles.rowContent}>
        <Text maxFontSizeMultiplier={1.3} style={styles.rowLabel}>
          {keyName}
        </Text>
      </View>
      <Switch
        accessibilityLabel={`${keyName}，${visible ? '已显示' : '已隐藏'}`}
        value={visible}
        onValueChange={onToggle}
        trackColor={{ false: theme.color.bg.subtle, true: theme.color.bg.selected }}
        thumbColor={visible ? theme.color.text.inverse : theme.color.text.secondary}
      />
    </View>
  )
}

type Props = {
  scrollRef: AnimatedRef<Animated.ScrollView>
  scrollOffsetY: SharedValue<number>
  scrollContentHeight: SharedValue<number>
  onDragActiveChange: (active: boolean) => void
}

export function TerminalShortcutSettings({
  scrollRef,
  scrollOffsetY,
  scrollContentHeight,
  onDragActiveChange
}: Props): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [customKeys, setCustomKeys] = useState<CustomKey[]>([])
  const [showCustomKeyModal, setShowCustomKeyModal] = useState(false)
  const [shortcutLayout, setShortcutLayout] = useState<TerminalAccessoryLayout>(
    getDefaultTerminalAccessoryLayout
  )
  const layoutWriteChainRef = useRef<Promise<void>>(Promise.resolve())
  const layoutWriteSeqRef = useRef(0)
  const pendingLayoutWritesRef = useRef(0)

  const persistLayout = useCallback((next: TerminalAccessoryLayout) => {
    layoutWriteSeqRef.current += 1
    pendingLayoutWritesRef.current += 1
    layoutWriteChainRef.current = layoutWriteChainRef.current
      .catch(() => {})
      .then(() => saveTerminalAccessoryLayout(next))
      .catch(() => {})
      .finally(() => {
        pendingLayoutWritesRef.current -= 1
      })
  }, [])

  const refreshShortcutLayout = useCallback(() => {
    const refreshSeq = layoutWriteSeqRef.current
    void loadTerminalAccessoryLayout().then((layout) => {
      if (pendingLayoutWritesRef.current > 0 || refreshSeq !== layoutWriteSeqRef.current) {
        return
      }
      setShortcutLayout({
        orderedBuiltInIds: layout.orderedBuiltInIds,
        visibleBuiltInIds: layout.visibleBuiltInIds
      })
    })
  }, [])

  const customKeysWriteChainRef = useRef<Promise<void>>(Promise.resolve())
  const customKeysWriteSeqRef = useRef(0)
  const pendingCustomKeysWritesRef = useRef(0)

  // Why: same stale-snapshot guard as persistLayout — a focus/AppState refresh
  // racing an in-flight save must not overwrite the optimistic state.
  const persistCustomKeys = useCallback((next: CustomKey[]) => {
    customKeysWriteSeqRef.current += 1
    pendingCustomKeysWritesRef.current += 1
    customKeysWriteChainRef.current = customKeysWriteChainRef.current
      .catch(() => {})
      .then(() => saveCustomKeys(next))
      .catch(() => {})
      .finally(() => {
        pendingCustomKeysWritesRef.current -= 1
      })
  }, [])

  const refreshCustomKeys = useCallback(() => {
    const refreshSeq = customKeysWriteSeqRef.current
    void loadCustomKeys().then((keys) => {
      if (pendingCustomKeysWritesRef.current > 0 || refreshSeq !== customKeysWriteSeqRef.current) {
        return
      }
      setCustomKeys(keys)
    })
  }, [])

  const handleDeleteCustomKey = useCallback(
    (key: CustomKey) => {
      setCustomKeys((current) => {
        const updated = current.filter((candidate) => candidate.id !== key.id)
        persistCustomKeys(updated)
        return updated
      })
    },
    [persistCustomKeys]
  )

  useFocusEffect(
    useCallback(() => {
      refreshShortcutLayout()
      refreshCustomKeys()
    }, [refreshShortcutLayout, refreshCustomKeys])
  )

  useEffect(() => {
    const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        refreshShortcutLayout()
        refreshCustomKeys()
      }
    })
    return () => sub.remove()
  }, [refreshShortcutLayout, refreshCustomKeys])

  const toggleBuiltInKey = useCallback(
    (id: string, visible: boolean) => {
      setShortcutLayout((current) => {
        const next = setTerminalAccessoryBuiltInVisible(current, id, visible)
        persistLayout(next)
        return next
      })
    },
    [persistLayout]
  )

  const reorderBuiltInKeys = useCallback(
    (orderedKeys: string[]) => {
      setShortcutLayout((current) => {
        const next = reorderTerminalAccessoryBuiltInIds(current, orderedKeys)
        persistLayout(next)
        return next
      })
    },
    [persistLayout]
  )

  const resetBuiltInKeys = useCallback(() => {
    const next = getDefaultTerminalAccessoryLayout()
    setShortcutLayout(next)
    persistLayout(next)
  }, [persistLayout])

  const reorderCustomKeys = useCallback(
    (orderedKeys: string[]) => {
      setCustomKeys((current) => {
        const byId = new Map(current.map((key) => [key.id, key]))
        const reordered = orderedKeys.flatMap((id) => {
          const key = byId.get(id)
          return key ? [key] : []
        })
        if (reordered.length !== current.length) {
          return current
        }
        persistCustomKeys(reordered)
        return reordered
      })
    },
    [persistCustomKeys]
  )

  const visibleBuiltInSet = useMemo(
    () => new Set(shortcutLayout.visibleBuiltInIds),
    [shortcutLayout.visibleBuiltInIds]
  )
  const orderedAccessoryKeys = useMemo(() => {
    const byId = new Map(TERMINAL_ACCESSORY_KEYS.map((key) => [key.id, key]))
    return shortcutLayout.orderedBuiltInIds.flatMap((id) => {
      const key = byId.get(id)
      return key ? [key] : []
    })
  }, [shortcutLayout.orderedBuiltInIds])

  return (
    <>
      <View style={styles.groups}>
        <View style={styles.settingsGroup}>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupHeading}>
            快捷键栏
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupDescription}>
            切换内置按键的显示状态；长按拖动手柄，可调整它们在终端快捷键栏中的顺序。
          </Text>
          <MobileGroupedList>
            <View>
              <DragReorderList
                items={orderedAccessoryKeys}
                itemKey={(shortcutKey) => shortcutKey.id}
                rowHeight={REORDER_ROW_HEIGHT}
                scrollRef={scrollRef}
                scrollOffsetY={scrollOffsetY}
                scrollContentHeight={scrollContentHeight}
                onDragActiveChange={onDragActiveChange}
                onReorder={reorderBuiltInKeys}
                renderRow={(shortcutKey) => (
                  <ShortcutBarRow
                    shortcutKey={shortcutKey}
                    visible={visibleBuiltInSet.has(shortcutKey.id)}
                    onToggle={(visible) => toggleBuiltInKey(shortcutKey.id, visible)}
                  />
                )}
              />
              <MobileGroupedListRow
                detail="显示所有内置快捷键，并还原初始顺序"
                onPress={resetBuiltInKeys}
                title="恢复默认设置"
              />
            </View>
          </MobileGroupedList>
        </View>

        <View style={styles.settingsGroup}>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupHeading}>
            自定义快捷键
          </Text>
          <MobileGroupedList>
            <View>
              {customKeys.length === 0 ? (
                <>
                  <View style={styles.emptyContainer}>
                    <Text maxFontSizeMultiplier={1.3} style={styles.emptyText}>
                      尚未添加自定义快捷键。
                    </Text>
                  </View>
                  <View style={styles.separator} />
                </>
              ) : (
                <DragReorderList
                  items={customKeys}
                  itemKey={(key) => key.id}
                  rowHeight={REORDER_ROW_HEIGHT}
                  scrollRef={scrollRef}
                  scrollOffsetY={scrollOffsetY}
                  scrollContentHeight={scrollContentHeight}
                  onDragActiveChange={onDragActiveChange}
                  onReorder={reorderCustomKeys}
                  renderRow={(key) => (
                    <View style={styles.reorderRowContent}>
                      <View style={styles.keycap}>
                        <Text maxFontSizeMultiplier={1.3} style={styles.keycapText}>
                          {key.label}
                        </Text>
                      </View>
                      <View style={styles.rowContent}>
                        <Text maxFontSizeMultiplier={1.3} style={styles.rowLabel}>
                          {key.label}
                        </Text>
                        <Text
                          maxFontSizeMultiplier={1.3}
                          style={styles.rowSublabel}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {key.bytes.replace(/\r/g, ' ↵')}
                        </Text>
                      </View>
                      <MobileIconButton
                        accessibilityLabel={`删除自定义快捷键 ${key.label}`}
                        icon={X}
                        iconSize={20}
                        onPress={() => handleDeleteCustomKey(key)}
                        tone="danger"
                      />
                    </View>
                  )}
                />
              )}
              <MobileGroupedListRow
                detail="创建组合键或文本宏"
                onPress={() => setShowCustomKeyModal(true)}
                title="添加自定义快捷键…"
                trailing={
                  <ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />
                }
              />
            </View>
          </MobileGroupedList>
        </View>
      </View>

      <CustomKeyModal
        visible={showCustomKeyModal}
        onClose={() => setShowCustomKeyModal(false)}
        onKeysChanged={(keys) => {
          // Why: the modal already persisted this list; bumping the sequence
          // discards refreshes that read storage before its save landed.
          customKeysWriteSeqRef.current += 1
          setCustomKeys(keys)
        }}
      />
    </>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    groups: {
      gap: theme.spacing.space24
    },
    settingsGroup: {
      gap: theme.spacing.space8
    },
    groupHeading: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      paddingHorizontal: theme.spacing.space4
    },
    groupDescription: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      paddingHorizontal: theme.spacing.space4
    },
    reorderRowContent: {
      flex: 1,
      height: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingLeft: theme.spacing.space16
    },
    rowContent: {
      flex: 1,
      minWidth: 0
    },
    rowLabel: {
      ...theme.typography.body,
      color: theme.color.text.primary
    },
    rowSublabel: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    keycap: {
      minWidth: theme.spacing.space64,
      alignItems: 'center',
      backgroundColor: theme.color.bg.subtle,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4
    },
    keycapText: {
      ...theme.typography.code,
      color: theme.color.text.secondary
    },
    separator: {
      height: 1,
      backgroundColor: theme.color.border.subtle,
      marginHorizontal: theme.spacing.space16
    },
    emptyContainer: {
      minHeight: theme.size.groupedListRowMinHeight,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    emptyText: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      textAlign: 'center'
    }
  })
}
