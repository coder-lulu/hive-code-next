import { APP_DISPLAY_NAME } from '@/product-brand'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue
} from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, Smartphone, Type } from 'lucide-react-native'
import {
  MobileGroupedList,
  MobileGroupedListRow,
  MobileIconButton,
  MobileScreenHeader
} from '../src/components/ui'
import { useAccountVisibleHostCatalog } from '../src/runtime-directory/use-account-visible-host-catalog'
import { selectConnectableHostProfiles } from '../src/transport/host-catalog-selection'
import { useFocusedSettingsHostClients } from '../src/transport/settings-host-client-connections'
import type { RpcClient } from '../src/transport/rpc-client'
import { PickerModal, type PickerOption } from '../src/components/PickerModal'
import { TerminalShortcutSettings } from '../src/components/TerminalShortcutSettings'
import { setTerminalAutoRestoreFitMsForHost } from '../src/terminal/terminal-auto-restore-fit-state'
import { createTerminalSettingsScreenStyles } from '../src/terminal/terminal-settings-screen-styles'
import { setTerminalSettingsScrollEnabled } from '../src/terminal/terminal-settings-scroll-lock'
import {
  loadTerminalAutocompleteEnabled,
  loadTerminalTextScale,
  saveTerminalAutocompleteEnabled,
  saveTerminalTextScale
} from '../src/storage/preferences'
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'

type RestoreValue = 'indefinite' | '60s' | '5m' | '30m'

type TextSizeValue = 'smallest' | 'smaller' | 'default' | 'large' | 'larger' | 'largest'

// scale = baseline zoom the terminal WebView applies on top of fit-to-width.
// Keep in sync with TERMINAL_TEXT_SCALES; pinch-to-zoom snaps to these values.
const TEXT_SIZE_OPTIONS: (PickerOption<TextSizeValue> & { scale: number })[] = [
  { value: 'smallest', label: '最小（50%）', scale: 0.5 },
  { value: 'smaller', label: '较小（75%）', scale: 0.75 },
  { value: 'default', label: '默认（100%）', scale: 1 },
  { value: 'large', label: '较大（125%）', scale: 1.25 },
  { value: 'larger', label: '更大（150%）', scale: 1.5 },
  { value: 'largest', label: '最大（200%）', scale: 2 }
]

function textSizeValueFromScale(scale: number): TextSizeValue {
  return TEXT_SIZE_OPTIONS.find((option) => option.scale === scale)?.value ?? 'default'
}

function textSizeSummary(scale: number): string {
  return (TEXT_SIZE_OPTIONS.find((option) => option.scale === scale) ?? TEXT_SIZE_OPTIONS[0]!).label
}

const AUTO_RESTORE_FIT_OPTIONS: (PickerOption<RestoreValue> & { ms: number | null })[] = [
  { value: 'indefinite', label: '保持手机尺寸（默认）', ms: null },
  { value: '60s', label: '1 分钟后', ms: 60_000 },
  { value: '5m', label: '5 分钟后', ms: 5 * 60_000 },
  { value: '30m', label: '30 分钟后', ms: 30 * 60_000 }
]

function valueFromMs(ms: number | null | undefined): RestoreValue {
  if (ms == null) {
    return 'indefinite'
  }
  const exact = AUTO_RESTORE_FIT_OPTIONS.find((option) => option.ms === ms)
  if (exact) {
    return exact.value
  }
  // Why: server may return a non-preset ms (custom value, future preset,
  // or server-side clamp). Snap to the closest finite preset so the
  // picker's selected radio agrees with the row sublabel.
  let closest: (typeof AUTO_RESTORE_FIT_OPTIONS)[number] | null = null
  let bestDelta = Infinity
  for (const option of AUTO_RESTORE_FIT_OPTIONS) {
    if (option.ms == null) {
      continue
    }
    const delta = Math.abs(option.ms - ms)
    if (delta < bestDelta) {
      bestDelta = delta
      closest = option
    }
  }
  return closest ? closest.value : 'indefinite'
}

function autoRestoreSummary(ms: number | null | undefined): string {
  if (ms === undefined) {
    return '…'
  }
  if (ms === null) {
    return AUTO_RESTORE_FIT_OPTIONS[0]!.label
  }
  const exact = AUTO_RESTORE_FIT_OPTIONS.find((option) => option.ms === ms)
  return exact ? exact.label : `${Math.round(ms / 1000)} 秒后`
}

function HostFitRow({
  client,
  hostName,
  ms,
  onPress
}: {
  client: RpcClient | null
  hostName: string
  ms: number | null | undefined
  onPress: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  return (
    <MobileGroupedListRow
      accessibilityLabel={`${hostName}，${autoRestoreSummary(ms)}`}
      detail={autoRestoreSummary(ms)}
      disabled={!client}
      leading={<Smartphone color={theme.color.text.secondary} size={20} strokeWidth={2} />}
      onPress={onPress}
      title={hostName}
      trailing={<ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />}
    />
  )
}

export default function TerminalSettingsScreen(): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createTerminalSettingsScreenStyles)
  const { catalog: hostCatalog } = useAccountVisibleHostCatalog()
  const hosts = useMemo(() => selectConnectableHostProfiles(hostCatalog), [hostCatalog])
  const hostIds = useMemo(() => hosts.map((host) => host.id), [hosts])
  const { clients: hostClients } = useFocusedSettingsHostClients(hostIds)
  const hostClientsById = useMemo(
    () => new Map(hostClients.map((entry) => [entry.hostId, entry.client])),
    [hostClients]
  )

  // Why: per-host current value, lazily fetched. We keep state at the
  // screen level rather than per-row so the picker can render at root
  // level — embedding PickerModal inside a row clipped its BottomDrawer
  // absoluteFill backdrop to the ScrollView content frame.
  const [hostMs, setHostMs] = useState<Record<string, number | null | undefined>>({})
  const [pickerHostId, setPickerHostId] = useState<string | null>(null)

  const [textScale, setTextScale] = useState(1)
  const [textSizePickerOpen, setTextSizePickerOpen] = useState(false)
  useEffect(() => {
    void loadTerminalTextScale().then(setTextScale)
  }, [])
  const selectTextSize = useCallback((value: TextSizeValue) => {
    const opt = TEXT_SIZE_OPTIONS.find((option) => option.value === value)
    if (!opt) {
      return
    }
    setTextScale(opt.scale)
    void saveTerminalTextScale(opt.scale)
  }, [])

  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false)
  // Why: a fast toggle before the initial load resolves must win — otherwise the
  // delayed read would clobber the user's choice with the stored (stale) value.
  const userToggledAutocompleteRef = useRef(false)
  useEffect(() => {
    let stale = false
    void loadTerminalAutocompleteEnabled().then((enabled) => {
      if (!stale && !userToggledAutocompleteRef.current) {
        setAutocompleteEnabled(enabled)
      }
    })
    return () => {
      stale = true
    }
  }, [])
  const toggleAutocomplete = useCallback((next: boolean) => {
    userToggledAutocompleteRef.current = true
    setAutocompleteEnabled(next)
    void saveTerminalAutocompleteEnabled(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    for (const host of hosts) {
      const client = hostClientsById.get(host.id) ?? null
      if (!client) {
        continue
      }
      void client
        .sendRequest('terminal.getAutoRestoreFit')
        .then((resp) => {
          if (cancelled) {
            return
          }
          const value = (resp as { ms?: number | null } | null)?.ms
          // Why: reconnect/status ticks can replay the same value; preserving
          // object identity avoids rerendering every settings row again.
          setHostMs((previous) => setTerminalAutoRestoreFitMsForHost(previous, host.id, value))
        })
        .catch(() => {
          if (!cancelled) {
            setHostMs((previous) => setTerminalAutoRestoreFitMsForHost(previous, host.id, null))
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [hosts, hostClientsById])

  async function selectValue(hostId: string, value: RestoreValue) {
    const client = hostClientsById.get(hostId) ?? null
    if (!client) {
      return
    }
    const opt = AUTO_RESTORE_FIT_OPTIONS.find((option) => option.value === value)
    if (!opt) {
      return
    }
    setHostMs((previous) => setTerminalAutoRestoreFitMsForHost(previous, hostId, opt.ms))
    try {
      const resp = (await client.sendRequest('terminal.setAutoRestoreFit', {
        ms: opt.ms
      })) as { ms?: number | null } | null
      setHostMs((previous) => setTerminalAutoRestoreFitMsForHost(previous, hostId, resp?.ms))
    } catch {
      try {
        const resp = (await client.sendRequest('terminal.getAutoRestoreFit')) as {
          ms?: number | null
        } | null
        setHostMs((previous) => setTerminalAutoRestoreFitMsForHost(previous, hostId, resp?.ms))
      } catch {
        // Give up silently; the next mount retries.
      }
    }
  }

  const pickerHost = pickerHostId ? hosts.find((host) => host.id === pickerHostId) : null

  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const scrollOffsetY = useSharedValue(0)
  const scrollContentHeight = useSharedValue(0)
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollOffsetY.value = event.contentOffset.y
  })
  // Why: imperative toggle instead of state — a re-render while a drag gesture
  // is active would rebuild the row gestures and could cancel the drag.
  const setScrollEnabled = useCallback(
    (enabled: boolean) => {
      setTerminalSettingsScrollEnabled(scrollRef, enabled)
    },
    [scrollRef]
  )
  const handleDragActiveChange = useCallback(
    (active: boolean) => setScrollEnabled(!active),
    [setScrollEnabled]
  )

  return (
    <GestureHandlerRootView style={styles.screen}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={() => router.back()}
          />
        }
        title="终端"
      />

      <Animated.ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + theme.spacing.space32 }
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onContentSizeChange={(_width, height) => {
          scrollContentHeight.value = height
        }}
      >
        <View style={styles.settingsGroup}>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupHeading}>
            离开应用时
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupDescription}>
            在手机上使用终端时，{APP_DISPLAY_NAME}
            会将终端缩小以适应屏幕。离开应用后，你可以让终端保持手机尺寸，避免交互式命令行工具重新排版；也可以在稍后恢复为电脑尺寸。终端横幅仍可随时手动恢复单个或全部终端。
          </Text>
          <MobileGroupedList>
            {hosts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text maxFontSizeMultiplier={1.3} style={styles.emptyText}>
                  尚未配对电脑。配对后可设置终端尺寸恢复行为。
                </Text>
              </View>
            ) : (
              hosts.map((host) => (
                <HostFitRow
                  key={host.id}
                  client={hostClientsById.get(host.id) ?? null}
                  hostName={host.name}
                  ms={hostMs[host.id]}
                  onPress={() => setPickerHostId(host.id)}
                />
              ))
            )}
          </MobileGroupedList>
        </View>

        <View style={styles.settingsGroup}>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupHeading}>
            文字大小
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupDescription}>
            调整终端文字缩放。较小字号可显示更多列；较大字号会显示更少列，可横向拖动查看。你也可以在终端中双指缩放，此设置会同步更新。该偏好仅影响此设备，不会改变电脑端终端。
          </Text>
          <MobileGroupedList>
            <MobileGroupedListRow
              accessibilityLabel={`终端文字大小，当前为${textSizeSummary(textScale)}`}
              detail={textSizeSummary(textScale)}
              leading={<Type color={theme.color.text.secondary} size={20} strokeWidth={2} />}
              onPress={() => setTextSizePickerOpen(true)}
              title="终端文字大小"
              trailing={
                <ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />
              }
            />
          </MobileGroupedList>
        </View>

        <View style={styles.settingsGroup}>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupHeading}>
            键盘输入
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupDescription}>
            为终端命令栏启用手机键盘的自动补全、自动更正和拼写建议。默认关闭，避免键盘改写命令、参数或路径。直接输入模式会将原始按键发送到终端，不受此设置影响。
          </Text>
          <MobileGroupedList>
            <MobileGroupedListRow
              detail={autocompleteEnabled ? '已开启' : '已关闭'}
              title="自动补全与自动更正"
              trailing={
                <Switch
                  accessibilityLabel="自动补全与自动更正"
                  value={autocompleteEnabled}
                  onValueChange={toggleAutocomplete}
                  trackColor={{
                    false: theme.color.bg.subtle,
                    true: theme.color.bg.selected
                  }}
                  thumbColor={
                    autocompleteEnabled ? theme.color.text.inverse : theme.color.text.secondary
                  }
                />
              }
            />
          </MobileGroupedList>
        </View>

        <TerminalShortcutSettings
          scrollRef={scrollRef}
          scrollOffsetY={scrollOffsetY}
          scrollContentHeight={scrollContentHeight}
          onDragActiveChange={handleDragActiveChange}
        />
      </Animated.ScrollView>

      <PickerModal<RestoreValue>
        visible={pickerHost != null}
        title={pickerHost ? `${pickerHost.name} 的终端尺寸` : ''}
        options={AUTO_RESTORE_FIT_OPTIONS}
        selected={valueFromMs(pickerHost ? hostMs[pickerHost.id] : null)}
        onSelect={(value) => {
          if (pickerHost) {
            void selectValue(pickerHost.id, value)
          }
        }}
        onClose={() => setPickerHostId(null)}
      />

      <PickerModal<TextSizeValue>
        visible={textSizePickerOpen}
        title="终端文字大小"
        options={TEXT_SIZE_OPTIONS}
        selected={textSizeValueFromScale(textScale)}
        onSelect={selectTextSize}
        onClose={() => setTextSizePickerOpen(false)}
      />
    </GestureHandlerRootView>
  )
}
