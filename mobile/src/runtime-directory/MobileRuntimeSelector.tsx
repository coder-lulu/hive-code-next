import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Check, Monitor, ScanLine, X } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import type { MobileTheme } from '../theme/mobile-theme'
import { useEnsureHostConnected } from '../transport/client-context'
import type { HostCatalogEntry } from '../transport/types'
import {
  projectRuntimeSelectorEntries,
  type RuntimeSelectorConnectionStates,
  type RuntimeSelectorEntry,
  type RuntimeSelectorTone
} from './runtime-selector-presentation'

type PendingAction = { type: 'select'; id: string } | { type: 'pair' } | null

export function MobileRuntimeSelector(props: {
  readonly catalog: readonly HostCatalogEntry[]
  readonly connectionStates: RuntimeSelectorConnectionStates
  readonly onClose: () => void
  readonly onPair: () => void
  readonly onSelect: (runtimeId: string) => void
  readonly selectedId: string | null
  readonly theme: MobileTheme
  readonly visible: boolean
}) {
  const styles = useMemo(() => createStyles(props.theme), [props.theme])
  const ensureHostConnected = useEnsureHostConnected()
  const pendingActionRef = useRef<PendingAction>(null)
  const selectionRequestRef = useRef(0)
  const [pendingRuntimeId, setPendingRuntimeId] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const entries = useMemo(
    () => projectRuntimeSelectorEntries(props.catalog, props.connectionStates, props.selectedId),
    [props.catalog, props.connectionStates, props.selectedId]
  )
  const accountEntries = entries.filter((entry) => entry.group === 'account')
  const localEntries = entries.filter((entry) => entry.group === 'local')

  useEffect(() => {
    if (!props.visible) {
      selectionRequestRef.current += 1
      setPendingRuntimeId(null)
      setSelectionError(null)
    }
    return () => {
      selectionRequestRef.current += 1
    }
  }, [props.visible])

  function closeWithAction(action: Exclude<PendingAction, null>) {
    pendingActionRef.current = action
    props.onClose()
  }

  function dismiss() {
    selectionRequestRef.current += 1
    pendingActionRef.current = null
    setPendingRuntimeId(null)
    setSelectionError(null)
    props.onClose()
  }

  async function selectRuntime(entry: RuntimeSelectorEntry): Promise<void> {
    if (pendingRuntimeId || !entry.selectable) {
      return
    }
    const profile = props.catalog.find((runtime) => runtime.id === entry.id)?.profile
    if (!profile) {
      return
    }
    if (props.connectionStates[entry.id] === 'connected') {
      closeWithAction({ type: 'select', id: entry.id })
      return
    }

    const request = selectionRequestRef.current + 1
    selectionRequestRef.current = request
    setPendingRuntimeId(entry.id)
    setSelectionError(null)
    try {
      const connected = await ensureHostConnected(profile)
      if (selectionRequestRef.current !== request) {
        return
      }
      setPendingRuntimeId(null)
      if (connected) {
        closeWithAction({ type: 'select', id: entry.id })
      } else {
        setSelectionError(`${entry.name} 暂时无法连接，请重试或选择其他 Runtime。`)
      }
    } catch {
      if (selectionRequestRef.current === request) {
        setPendingRuntimeId(null)
        setSelectionError(`${entry.name} 暂时无法连接，请重试或选择其他 Runtime。`)
      }
    }
  }

  function completePendingAction() {
    const action = pendingActionRef.current
    pendingActionRef.current = null
    if (action?.type === 'select') {
      props.onSelect(action.id)
    } else if (action?.type === 'pair') {
      props.onPair()
    }
  }

  return (
    <BottomDrawer visible={props.visible} onAfterClose={completePendingAction} onClose={dismiss}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>
            选择 Runtime
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.description}>
            任务仅在你选择的设备上运行
          </Text>
        </View>
        <Pressable
          accessibilityLabel="关闭 Runtime 选择器"
          accessibilityRole="button"
          onPress={dismiss}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <X color={props.theme.color.text.secondary} size={24} strokeWidth={1.9} />
        </Pressable>
      </View>

      {entries.length === 0 ? (
        <View style={styles.emptyState}>
          <Monitor color={props.theme.color.text.tertiary} size={32} strokeWidth={1.8} />
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            还没有可用的 Runtime
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyDescription}>
            配对电脑后，工作区与任务状态会在这里显示。
          </Text>
        </View>
      ) : (
        <>
          <RuntimeGroup
            entries={accountEntries}
            label="账号 Runtime"
            onSelect={(entry) => void selectRuntime(entry)}
            pendingRuntimeId={pendingRuntimeId}
            styles={styles}
            theme={props.theme}
          />
          <RuntimeGroup
            entries={localEntries}
            label="本地配对"
            onSelect={(entry) => void selectRuntime(entry)}
            pendingRuntimeId={pendingRuntimeId}
            styles={styles}
            theme={props.theme}
          />
        </>
      )}

      {selectionError ? (
        <Text accessibilityLiveRegion="polite" style={styles.selectionError}>
          {selectionError}
        </Text>
      ) : null}

      <Pressable
        accessibilityLabel="配对新电脑"
        accessibilityRole="button"
        accessibilityState={{ disabled: pendingRuntimeId != null }}
        disabled={pendingRuntimeId != null}
        onPress={() => closeWithAction({ type: 'pair' })}
        style={({ pressed }) => [
          styles.pairButton,
          pendingRuntimeId != null && styles.disabled,
          pressed && styles.pressed
        ]}
      >
        <ScanLine color={props.theme.color.text.primary} size={22} strokeWidth={1.9} />
        <Text maxFontSizeMultiplier={1.3} style={styles.pairButtonText}>
          配对新电脑
        </Text>
      </Pressable>
    </BottomDrawer>
  )
}

function RuntimeGroup(props: {
  readonly entries: readonly RuntimeSelectorEntry[]
  readonly label: string
  readonly onSelect: (entry: RuntimeSelectorEntry) => void
  readonly pendingRuntimeId: string | null
  readonly styles: ReturnType<typeof createStyles>
  readonly theme: MobileTheme
}) {
  if (props.entries.length === 0) {
    return null
  }
  return (
    <View style={props.styles.section}>
      <Text maxFontSizeMultiplier={1.3} style={props.styles.sectionTitle}>
        {props.label}
      </Text>
      <View style={props.styles.group}>
        {props.entries.map((entry, index) => (
          <View key={entry.id}>
            {index > 0 ? <View style={props.styles.separator} /> : null}
            <RuntimeRow
              entry={entry}
              disabled={!entry.selectable || props.pendingRuntimeId != null}
              pending={props.pendingRuntimeId === entry.id}
              onPress={() => props.onSelect(entry)}
              styles={props.styles}
              theme={props.theme}
            />
          </View>
        ))}
      </View>
    </View>
  )
}

function RuntimeRow(props: {
  readonly entry: RuntimeSelectorEntry
  readonly disabled: boolean
  readonly onPress: () => void
  readonly pending: boolean
  readonly styles: ReturnType<typeof createStyles>
  readonly theme: MobileTheme
}) {
  const statusColor = runtimeToneColor(props.entry.tone, props.theme)
  const statusTextColor = runtimeToneTextColor(props.entry.tone, props.theme)
  const connecting =
    props.pending || props.entry.statusLabel === '连接中' || props.entry.statusLabel === '正在重连'
  return (
    <Pressable
      accessibilityLabel={`${props.entry.name}，${props.entry.detail}，${props.entry.statusLabel}`}
      accessibilityRole="radio"
      accessibilityState={{
        busy: connecting,
        disabled: props.disabled,
        selected: props.entry.selected
      }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        props.styles.row,
        props.entry.selected && props.styles.rowSelected,
        props.disabled && !props.pending && props.styles.disabled,
        pressed && props.styles.pressed
      ]}
    >
      <View style={props.styles.runtimeIcon}>
        <Monitor color={props.theme.color.text.primary} size={22} strokeWidth={1.9} />
      </View>
      <View style={props.styles.rowCopy}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={props.styles.rowTitle}>
          {props.entry.name}
        </Text>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={props.styles.rowDetail}>
          {props.entry.detail}
        </Text>
      </View>
      <View style={props.styles.status}>
        {connecting ? (
          <ActivityIndicator color={statusColor} size="small" />
        ) : (
          <View style={[props.styles.statusDot, { backgroundColor: statusColor }]} />
        )}
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={[props.styles.statusText, { color: statusTextColor }]}
        >
          {props.entry.statusLabel}
        </Text>
      </View>
      {props.entry.selected ? (
        <View style={props.styles.selectedIcon}>
          <Check color={props.theme.color.text.inverse} size={16} strokeWidth={2.1} />
        </View>
      ) : null}
    </Pressable>
  )
}

function runtimeToneColor(tone: RuntimeSelectorTone, theme: MobileTheme): string {
  if (tone === 'success') {
    return theme.color.status.success
  }
  if (tone === 'warning') {
    return theme.color.status.warning
  }
  return theme.color.text.tertiary
}

function runtimeToneTextColor(tone: RuntimeSelectorTone, theme: MobileTheme): string {
  if (tone === 'success') {
    return theme.color.status.successText
  }
  if (tone === 'warning') {
    return theme.color.status.warningText
  }
  return theme.color.text.secondary
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: {
      minHeight: theme.spacing.space64,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space12,
      paddingBottom: theme.spacing.space20
    },
    headerCopy: { minWidth: 0, flex: 1, gap: theme.spacing.space4 },
    title: { ...theme.typography.pageTitle, color: theme.color.text.primary },
    description: { ...theme.typography.meta, color: theme.color.text.secondary },
    closeButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    pressed: { backgroundColor: theme.color.bg.subtle },
    disabled: { opacity: 0.55 },
    section: { gap: theme.spacing.space8, marginBottom: theme.spacing.space20 },
    sectionTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    group: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: theme.spacing.space64,
      backgroundColor: theme.color.border.subtle
    },
    row: {
      minHeight: theme.spacing.space64 + theme.spacing.space16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12
    },
    rowSelected: { backgroundColor: theme.color.brand.subtle },
    runtimeIcon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    rowCopy: { minWidth: 0, flex: 1, gap: theme.spacing.space4 },
    rowTitle: { ...theme.typography.body, color: theme.color.text.primary, fontWeight: '600' },
    rowDetail: { ...theme.typography.caption, color: theme.color.text.secondary },
    status: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space4 },
    statusDot: {
      width: theme.spacing.space8,
      height: theme.spacing.space8,
      borderRadius: theme.radii.circle
    },
    statusText: { ...theme.typography.caption, fontWeight: '500' },
    selectionError: {
      ...theme.typography.meta,
      marginBottom: theme.spacing.space12,
      color: theme.color.text.secondary
    },
    selectedIcon: {
      width: theme.spacing.space24,
      height: theme.spacing.space24,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.brand.primary
    },
    emptyState: {
      minHeight: theme.spacing.space64 * 2,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      marginBottom: theme.spacing.space20,
      paddingHorizontal: theme.spacing.space20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    emptyTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    emptyDescription: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    pairButton: {
      minHeight: theme.spacing.space48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    pairButtonText: { ...theme.typography.label, color: theme.color.text.primary }
  })
}
