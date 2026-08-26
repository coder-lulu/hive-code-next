import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import Constants from 'expo-constants'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { Check, ChevronLeft, Copy } from 'lucide-react-native'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { MobileIconButton, MobileScreenHeader } from '../src/components/ui'
import { buildConnectionDiagnosticsReport } from '../src/diagnostics/connection-diagnostics-report'
import type { MobileTheme } from '../src/theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'
import { useHostClient } from '../src/transport/client-context'
import {
  useLastConnectedAt,
  useReconnectAttempt
} from '../src/transport/client-context-connection-metrics'
import { connectionLogStore } from '../src/transport/connection-log-buffer'
import { loadHosts } from '../src/transport/host-store'
import type { ConnectionLogEntry, ConnectionState, HostProfile } from '../src/transport/types'

const EMPTY_ENTRIES: readonly ConnectionLogEntry[] = []

const CONNECTION_STATE_LABELS: Readonly<Record<ConnectionState, string>> = {
  connecting: '正在连接',
  handshaking: '正在验证',
  connected: '已连接',
  disconnected: '已断开',
  reconnecting: '正在重连',
  'auth-failed': '验证失败'
}

// Opening the log acquires the selected host client so a failing dial can fill the log live.
export default function ConnectionLogScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let stale = false
    void loadHosts().then((loaded) => {
      if (stale) {
        return
      }
      setHosts(loaded)
      setSelectedId((previous) => previous ?? loaded[0]?.id ?? null)
    })
    return () => {
      stale = true
    }
  }, [])

  const selected = hosts.find((host) => host.id === selectedId) ?? null
  const { state } = useHostClient(selected?.id)
  const reconnectAttempts = useReconnectAttempt(selected?.id)
  const lastConnectedAt = useLastConnectedAt(selected?.id)

  const subscribe = useCallback(
    (listener: () => void) =>
      selectedId ? connectionLogStore.subscribe(selectedId, listener) : () => {},
    [selectedId]
  )
  const getSnapshot = useCallback(
    () => (selectedId ? connectionLogStore.get(selectedId) : EMPTY_ENTRIES),
    [selectedId]
  )
  const entries = useSyncExternalStore(subscribe, getSnapshot)

  const copyDiagnostics = useCallback(async () => {
    if (!selected) {
      return
    }
    const report = buildConnectionDiagnosticsReport({
      hostName: selected.name,
      endpoint: selected.endpoint,
      state,
      reconnectAttempts,
      lastConnectedAt,
      platform: `${Platform.OS} ${Platform.Version ?? ''}`.trim(),
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      entries
    })
    await Clipboard.setStringAsync(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [selected, state, reconnectAttempts, lastConnectedAt, entries])

  return (
    <View style={styles.screen}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={() => router.back()}
          />
        }
        title="连接日志"
      />

      <View style={[styles.content, { paddingBottom: insets.bottom + theme.spacing.space20 }]}>
        {hosts.length > 1 ? (
          <ScrollView
            horizontal
            contentContainerStyle={styles.hostPicker}
            showsHorizontalScrollIndicator={false}
            style={styles.hostPickerScroll}
          >
            {hosts.map((host) => {
              const selectedHost = host.id === selectedId
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: selectedHost }}
                  key={host.id}
                  style={({ pressed }) => [
                    styles.hostChip,
                    selectedHost && styles.hostChipActive,
                    pressed && styles.hostChipPressed
                  ]}
                  onPress={() => setSelectedId(host.id)}
                >
                  <Text
                    maxFontSizeMultiplier={1.3}
                    numberOfLines={1}
                    style={[styles.hostChipText, selectedHost && styles.hostChipTextActive]}
                  >
                    {host.name}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}

        {selected ? (
          <View style={styles.logArea}>
            <View style={styles.statusRow}>
              <Text
                accessibilityLiveRegion="polite"
                maxFontSizeMultiplier={1.3}
                style={styles.statusText}
              >
                {CONNECTION_STATE_LABELS[state]}
                {reconnectAttempts > 0 ? ` · 第 ${reconnectAttempts} 次重连` : ''}
              </Text>
              <Pressable
                accessibilityLabel={copied ? '诊断信息已复制' : '复制诊断信息'}
                accessibilityRole="button"
                style={({ pressed }) => [styles.copyButton, pressed && styles.copyButtonPressed]}
                onPress={() => void copyDiagnostics()}
              >
                {copied ? (
                  <Check size={20} color={theme.color.status.success} strokeWidth={2} />
                ) : (
                  <Copy size={20} color={theme.color.text.secondary} strokeWidth={2} />
                )}
                <Text maxFontSizeMultiplier={1.3} style={styles.copyButtonText}>
                  {copied ? '已复制' : '复制诊断信息'}
                </Text>
              </Pressable>
            </View>
            {entries.length > 0 ? (
              <ConnectionLog entries={[...entries]} title={selected.name} />
            ) : (
              <View style={styles.emptyNotice}>
                <Text maxFontSizeMultiplier={1.3} style={styles.emptyText}>
                  本次会话还没有连接事件。应用尝试连接这台电脑时，事件会显示在这里。
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.emptyNotice}>
            <Text maxFontSizeMultiplier={1.3} style={styles.emptyText}>
              暂无已配对电脑。
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    content: {
      flex: 1,
      gap: theme.spacing.space16,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20
    },
    hostPickerScroll: { flexGrow: 0 },
    hostPicker: { gap: theme.spacing.space8 },
    hostChip: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.circle,
      backgroundColor: theme.color.bg.subtle
    },
    hostChipActive: { backgroundColor: theme.color.bg.selected },
    hostChipPressed: { opacity: 0.72 },
    hostChipText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    hostChipTextActive: { color: theme.color.text.inverse, fontWeight: '500' },
    logArea: { flex: 1, gap: theme.spacing.space12 },
    statusRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.space8
    },
    statusText: { ...theme.typography.meta, color: theme.color.text.secondary },
    copyButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    copyButtonPressed: { backgroundColor: theme.color.bg.subtle },
    copyButtonText: { ...theme.typography.label, color: theme.color.text.primary },
    emptyNotice: {
      padding: theme.spacing.space16,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    emptyText: { ...theme.typography.meta, color: theme.color.text.secondary }
  })
}
