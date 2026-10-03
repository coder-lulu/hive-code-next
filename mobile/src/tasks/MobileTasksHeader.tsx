import { useMemo } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronDown, Plus, RefreshCw } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import { hostTasksRoute } from '../host-route-action-state'
import { MobileRuntimeSelector } from '../runtime-directory/MobileRuntimeSelector'
import { presentRuntimeConnection } from '../runtime-directory/runtime-connection-presentation'
import { useAccountVisibleHostCatalog } from '../runtime-directory/use-account-visible-host-catalog'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import type { ConnectionState } from '../transport/types'
import { useAllHostClients } from '../transport/use-all-host-clients'

const NO_AUTO_CONNECT_HOSTS: readonly string[] = []

export function MobileTasksHeader(props: {
  readonly busy: boolean
  readonly connectionState: ConnectionState
  readonly hostId: string
  readonly onCreate: () => void
  readonly onRefresh: () => void
  readonly onRuntimeSelectorVisibleChange: (visible: boolean) => void
  readonly runtimeSelectorVisible: boolean
  readonly showCreateTask: boolean
  readonly taskUiReady: boolean
}) {
  const router = useRouter()
  const theme = useMobileTheme()
  const styles = useMemo(() => createStyles(theme), [theme])
  const { catalog } = useAccountVisibleHostCatalog()
  const hostIds = useMemo(() => catalog.map((entry) => entry.id), [catalog])
  const runtimeClients = useAllHostClients(hostIds, { autoConnectHostIds: NO_AUTO_CONNECT_HOSTS })
  const connectionStates = useMemo(
    () =>
      Object.fromEntries([
        ...runtimeClients.map((entry) => [entry.hostId, entry.state] as const),
        [props.hostId, props.connectionState] as const
      ]),
    [props.connectionState, props.hostId, runtimeClients]
  )
  const currentRuntime = catalog.find((entry) => entry.id === props.hostId)
  const runtimeStatus = presentRuntimeConnection(props.connectionState, currentRuntime)
  const runtimeStatusColor = connectionColor(runtimeStatus.tone, theme)
  const runtimeStatusTextStyle =
    runtimeStatus.tone === 'success'
      ? styles.runtimeStatusSuccess
      : runtimeStatus.tone === 'warning'
        ? styles.runtimeStatusWarning
        : runtimeStatus.tone === 'danger'
          ? styles.runtimeStatusDanger
          : undefined

  return (
    <>
      <View style={styles.header}>
        <View style={styles.side}>
          <Pressable
            accessibilityLabel={`选择 Runtime，当前为 ${currentRuntime?.name ?? '未命名设备'}，${runtimeStatus.accessibilityLabel}`}
            accessibilityRole="button"
            onPress={() => props.onRuntimeSelectorVisibleChange(true)}
            style={({ pressed }) => [styles.runtimeButton, pressed && styles.pressed]}
          >
            <View style={[styles.statusDot, { backgroundColor: runtimeStatusColor }]} />
            <View style={styles.runtimeCopy}>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.runtimeName}>
                {currentRuntime?.name ?? 'Runtime'}
              </Text>
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={[styles.runtimeStatusText, runtimeStatusTextStyle]}
              >
                {runtimeStatus.label}
              </Text>
            </View>
            <ChevronDown color={theme.color.text.secondary} size={16} strokeWidth={1.9} />
          </Pressable>
        </View>

        <View pointerEvents="none" style={styles.titleWrap}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.title}>
            任务中心
          </Text>
        </View>

        <View style={[styles.side, styles.actions]}>
          {props.showCreateTask ? (
            <Pressable
              accessibilityLabel="新建任务"
              accessibilityRole="button"
              accessibilityState={{ disabled: !props.taskUiReady }}
              disabled={!props.taskUiReady}
              onPress={props.onCreate}
              style={({ pressed }) => [
                styles.createButton,
                pressed && styles.pressed,
                !props.taskUiReady && styles.disabled
              ]}
            >
              <Plus color={theme.color.brand.primary} size={18} strokeWidth={2} />
              <Text maxFontSizeMultiplier={1.3} style={styles.createButtonText}>
                新建
              </Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="刷新任务"
              accessibilityRole="button"
              accessibilityState={{ disabled: !props.taskUiReady || props.busy }}
              disabled={!props.taskUiReady || props.busy}
              onPress={props.onRefresh}
              style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
            >
              {props.busy ? (
                <ActivityIndicator color={theme.color.text.secondary} size="small" />
              ) : (
                <RefreshCw color={theme.color.text.primary} size={20} strokeWidth={1.9} />
              )}
            </Pressable>
          )}
        </View>
      </View>

      <MobileRuntimeSelector
        catalog={catalog}
        connectionStates={connectionStates}
        onClose={() => props.onRuntimeSelectorVisibleChange(false)}
        onPair={() => router.push('/pair-scan')}
        onSelect={(runtimeId) => {
          if (runtimeId !== props.hostId) {
            router.replace(hostTasksRoute(runtimeId))
          }
        }}
        selectedId={props.hostId}
        theme={theme}
        visible={props.runtimeSelectorVisible}
      />
    </>
  )
}

function connectionColor(
  tone: ReturnType<typeof presentRuntimeConnection>['tone'],
  theme: MobileTheme
): string {
  if (tone === 'success') {
    return theme.color.status.success
  }
  if (tone === 'warning') {
    return theme.color.status.warning
  }
  if (tone === 'danger') {
    return theme.color.status.danger
  }
  return theme.color.text.tertiary
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    header: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space20
    },
    side: {
      width: theme.size.minimumTouchTarget * 2 + theme.spacing.space4,
      flexDirection: 'row',
      alignItems: 'center'
    },
    actions: { justifyContent: 'flex-end' },
    runtimeButton: {
      minWidth: 0,
      maxWidth: '100%',
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space4,
      borderRadius: theme.radii.control
    },
    statusDot: {
      width: theme.spacing.space8,
      height: theme.spacing.space8,
      flexShrink: 0,
      borderRadius: theme.radii.circle
    },
    runtimeCopy: { minWidth: 0, flexShrink: 1 },
    runtimeName: {
      ...theme.typography.caption,
      minWidth: 0,
      flexShrink: 1,
      color: theme.color.text.primary,
      fontWeight: theme.typography.sectionTitle.fontWeight
    },
    runtimeStatusText: { ...theme.typography.caption, color: theme.color.text.secondary },
    runtimeStatusSuccess: { color: theme.color.status.successText },
    runtimeStatusWarning: { color: theme.color.status.warningText },
    runtimeStatusDanger: { color: theme.color.status.dangerText },
    titleWrap: { minWidth: 0, flex: 1, alignItems: 'center', justifyContent: 'center' },
    title: { ...theme.typography.pageTitle, color: theme.color.text.primary, textAlign: 'center' },
    createButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    createButtonText: {
      ...theme.typography.label,
      color: theme.color.brand.primary,
      fontWeight: theme.typography.sectionTitle.fontWeight
    },
    refreshButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    pressed: { backgroundColor: theme.color.bg.subtle },
    disabled: { opacity: 0.45 }
  })
}
