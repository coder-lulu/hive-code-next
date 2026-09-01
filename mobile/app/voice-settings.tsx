import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomDrawer } from '../src/components/BottomDrawer'
import {
  MobileGroupedList,
  MobileGroupedListRow,
  MobileIconButton,
  MobileScreenHeader,
  MobileSegmentedControl
} from '../src/components/ui'
import { VoiceModelList } from '../src/components/VoiceModelList'
import {
  deleteDictationModel,
  downloadDictationModel,
  fetchDictationSetup,
  isModelInFlight,
  setDictationConfig,
  type MobileSpeechModel,
  type MobileSpeechSetup
} from '../src/dictation/mobile-dictation-setup'
import { useDictationSetupPoller } from '../src/dictation/use-dictation-setup-poller'
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'
import { createVoiceSettingsStyles } from '../src/settings/voice-settings-styles'
import { useAccountVisibleHostCatalog } from '../src/runtime-directory/use-account-visible-host-catalog'
import { selectConnectableHostProfiles } from '../src/transport/host-catalog-selection'
import type { RpcClient } from '../src/transport/rpc-client'
import { useFocusedSettingsHostClients } from '../src/transport/settings-host-client-connections'

const POLL_INTERVAL_MS = 1500

const DICTATION_MODES = [
  { value: 'toggle', label: '点按切换' },
  { value: 'hold', label: '按住说话' }
] as const

type ModelBusyAction = { modelId: string; type: 'download' | 'select' | 'delete' }

export default function VoiceSettingsScreen(): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createVoiceSettingsStyles)

  const { catalog: hostCatalog } = useAccountVisibleHostCatalog()
  const hosts = useMemo(() => selectConnectableHostProfiles(hostCatalog), [hostCatalog])
  const hostIds = useMemo(() => hosts.map((host) => host.id), [hosts])
  const { clients: hostClients, focused: routeFocused } = useFocusedSettingsHostClients(hostIds)
  // Voice dictation runs on the paired desktop, so pick the first connected host.
  const client: RpcClient | null = useMemo(
    () => hostClients.find((entry) => entry.state === 'connected')?.client ?? null,
    [hostClients]
  )

  const [setup, setSetup] = useState<MobileSpeechSetup | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<ModelBusyAction | null>(null)
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false)
  const refresh = useCallback(async (): Promise<boolean | undefined> => {
    if (!client) {
      return false
    }
    try {
      const next = await fetchDictationSetup(client)
      setSetup(next)
      setError(null)
      return next.models.some(isModelInFlight)
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载语音设置')
      return undefined
    } finally {
      setLoading(false)
    }
  }, [client])

  const polling = setup?.models.some(isModelInFlight) ?? false
  const refreshSetup = useDictationSetupPoller({
    visible: routeFocused && client !== null,
    polling,
    refresh,
    intervalMs: POLL_INTERVAL_MS
  })

  useEffect(() => {
    if (routeFocused && client && setup === null) {
      setLoading(true)
    }
  }, [routeFocused, client, setup])

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!client) {
        return
      }
      setError(null)
      setSetup((previous) => (previous ? { ...previous, enabled } : previous))
      try {
        setSetup(await setDictationConfig(client, { enabled }))
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法更新语音设置')
        void refreshSetup()
      }
    },
    [client, refreshSetup]
  )

  const handleSelectMode = useCallback(
    async (dictationMode: 'toggle' | 'hold') => {
      if (!client) {
        return
      }
      setError(null)
      setSetup((previous) => (previous ? { ...previous, dictationMode } : previous))
      try {
        setSetup(await setDictationConfig(client, { dictationMode }))
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法更新听写方式')
        void refreshSetup()
      }
    },
    [client, refreshSetup]
  )

  const handleUseModel = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      setBusyAction({ modelId: model.id, type: 'select' })
      setError(null)
      try {
        setSetup(await setDictationConfig(client, { enabled: true, modelId: model.id }))
        setModelDrawerOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法选择语音模型')
      } finally {
        setBusyAction(null)
      }
    },
    [client]
  )

  const handleDownload = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      setBusyAction({ modelId: model.id, type: 'download' })
      setError(null)
      try {
        await downloadDictationModel(client, model.id)
        await refreshSetup()
      } catch (err) {
        setError(err instanceof Error ? err.message : '模型下载失败')
      } finally {
        setBusyAction(null)
      }
    },
    [client, refreshSetup]
  )

  const handleDelete = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      const deletedSelectedModel = setup?.selectedModelId === model.id
      setBusyAction({ modelId: model.id, type: 'delete' })
      setError(null)
      try {
        setSetup(await deleteDictationModel(client, model.id))
        if (deletedSelectedModel) {
          setModelDrawerOpen(false)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '模型删除失败')
      } finally {
        setBusyAction(null)
      }
    },
    [client, setup?.selectedModelId]
  )

  const enabled = setup?.enabled ?? false
  const selectedModel = setup?.models.find((model) => model.id === setup.selectedModelId)
  const selectedModelLabel = selectedModel?.label ?? '未选择'

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
        title="语音"
      />

      {!client ? (
        <View style={styles.centerState}>
          <View style={styles.notice}>
            <Text maxFontSizeMultiplier={1.3} style={styles.noticeTitle}>
              尚未连接电脑
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.noticeDetail}>
              连接电脑后才能管理语音设置。听写在已连接电脑上运行，此页面不会模拟远端能力。
            </Text>
          </View>
        </View>
      ) : loading && setup === null ? (
        <View accessibilityLiveRegion="polite" style={styles.centerState}>
          <ActivityIndicator color={theme.color.text.secondary} />
          <Text maxFontSizeMultiplier={1.3} style={styles.stateText}>
            正在加载语音设置…
          </Text>
        </View>
      ) : setup === null ? (
        <View style={styles.centerState}>
          <View accessibilityRole="alert" style={styles.errorNotice}>
            <Text maxFontSizeMultiplier={1.3} style={styles.errorText}>
              {error ?? '无法加载语音设置。'}
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + theme.spacing.space32 }
          ]}
          showsVerticalScrollIndicator={false}
        >
          <MobileGroupedList title="语音听写">
            <View style={styles.row}>
              <View style={styles.rowCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.rowTitle}>
                  启用语音听写
                </Text>
                <Text maxFontSizeMultiplier={1.3} style={styles.rowDetail}>
                  将语音转成文字并输入到电脑上当前聚焦的窗格。
                </Text>
              </View>
              <Switch
                accessibilityLabel="启用语音听写"
                value={enabled}
                onValueChange={(value) => void handleToggleEnabled(value)}
                trackColor={{ false: theme.color.bg.subtle, true: theme.color.bg.selected }}
                thumbColor={enabled ? theme.color.text.inverse : theme.color.text.secondary}
              />
            </View>
            <View style={styles.modeRow}>
              <View style={styles.rowCopy}>
                <Text maxFontSizeMultiplier={1.3} style={styles.rowTitle}>
                  听写方式
                </Text>
                <Text maxFontSizeMultiplier={1.3} style={styles.rowDetail}>
                  点按切换：点一次开始，再点一次停止。按住说话：仅在按住时听写。
                </Text>
              </View>
              <MobileSegmentedControl
                accessibilityLabel="听写方式"
                disabled={!enabled}
                onValueChange={(value) => void handleSelectMode(value)}
                options={DICTATION_MODES}
                value={setup.dictationMode}
              />
            </View>
          </MobileGroupedList>

          <MobileGroupedList title="语音模型">
            <MobileGroupedListRow
              accessibilityLabel={`语音模型，当前为${selectedModelLabel}`}
              detail={selectedModelLabel}
              disabled={!enabled}
              onPress={() => setModelDrawerOpen(true)}
              title="语音模型"
              trailing={
                <ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />
              }
            />
          </MobileGroupedList>

          {error ? (
            <View
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              style={styles.errorNotice}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.errorText}>
                {error}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      <BottomDrawer visible={modelDrawerOpen} onClose={() => setModelDrawerOpen(false)}>
        <Text maxFontSizeMultiplier={1.3} style={styles.drawerTitle}>
          语音模型
        </Text>
        {setup ? (
          <VoiceModelList
            setup={setup}
            disabled={false}
            busyAction={busyAction}
            onUseModel={(model) => void handleUseModel(model)}
            onDownload={(model) => void handleDownload(model)}
            onDelete={(model) => void handleDelete(model)}
          />
        ) : null}
      </BottomDrawer>
    </View>
  )
}
