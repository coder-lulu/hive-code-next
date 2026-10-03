import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { VoiceSettingsOperations } from './voice-settings-operations'
import { createVoiceSettingsStyles } from './voice-settings-styles'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import {
  MobileGroupedList,
  MobileGroupedListRow,
  MobileIconButton,
  MobileScreenHeader,
  MobileSegmentedControl
} from '../components/ui'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { VoiceModelList } from '../components/VoiceModelList'
import { useDictationSetupPoller } from '../dictation/use-dictation-setup-poller'
import {
  isModelInFlight,
  type MobileSpeechModel,
  type MobileSpeechSetup
} from '../dictation/mobile-dictation-setup'

const POLL_INTERVAL_MS = 1500

const DICTATION_MODES = [
  { value: 'toggle', label: '点按切换' },
  { value: 'hold', label: '按住说话' }
] as const

type ModelBusyAction = { modelId: string; type: 'download' | 'select' | 'delete' }

export default function VoiceSettingsScreen({
  operations,
  focused,
  onBack
}: {
  operations: VoiceSettingsOperations | null
  focused: boolean
  onBack: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createVoiceSettingsStyles)
  const insets = useSafeAreaInsets()
  const [setup, setSetup] = useState<MobileSpeechSetup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<ModelBusyAction | null>(null)
  const requestEpoch = useRef(0)
  const [modelDrawerOpen, setModelDrawerOpen] = useState(false)
  const refresh = useCallback(async (): Promise<boolean | undefined> => {
    if (!operations) {
      return false
    }
    const epoch = requestEpoch.current
    // Own the spinner from the read that clears it, so a retry after a failed load shows
    // the spinner again instead of the stale error card. Reads are serialised by
    // DictationSetupPollController, so no in-flight read can clear another's flag.
    setLoading(true)
    try {
      const next = await operations.load()
      if (epoch !== requestEpoch.current) {
        return undefined
      }
      setSetup(next)
      setError(null)
      return next.models.some(isModelInFlight)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice settings')
      return undefined
    } finally {
      setLoading(false)
    }
  }, [operations])

  const polling = setup?.models.some(isModelInFlight) ?? false
  const refreshSetup = useDictationSetupPoller({
    visible: focused && operations !== null,
    polling,
    refresh,
    intervalMs: POLL_INTERVAL_MS
  })

  const configure = useCallback(
    async (params: Parameters<VoiceSettingsOperations['configure']>[0]) => {
      if (!operations) {
        return
      }
      requestEpoch.current += 1
      setError(null)
      // Optimistic flip so the control responds instantly; reconcile below.
      const { enabled, dictationMode } = params
      setSetup((prev) =>
        prev
          ? {
              ...prev,
              ...(enabled === undefined ? {} : { enabled }),
              ...(dictationMode === undefined ? {} : { dictationMode })
            }
          : prev
      )
      try {
        setSetup(await operations.configure(params))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
        void refreshSetup()
      }
    },
    [operations, refreshSetup]
  )

  const handleUseModel = useCallback(
    async (model: MobileSpeechModel) => {
      if (!operations) {
        return
      }
      requestEpoch.current += 1
      setBusyAction({ modelId: model.id, type: 'select' })
      setError(null)
      try {
        setSetup(await operations.configure({ enabled: true, modelId: model.id }))
        setModelDrawerOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not select model')
      } finally {
        setBusyAction(null)
      }
    },
    [operations]
  )

  const handleDownload = useCallback(
    async (model: MobileSpeechModel) => {
      if (!operations) {
        return
      }
      requestEpoch.current += 1
      setBusyAction({ modelId: model.id, type: 'download' })
      setError(null)
      try {
        await operations.download(model.id)
        await refreshSetup()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Download failed')
      } finally {
        setBusyAction(null)
      }
    },
    [operations, refreshSetup]
  )

  const handleDelete = useCallback(
    async (model: MobileSpeechModel) => {
      if (!operations) {
        return
      }
      const deletedSelectedModel = setup?.selectedModelId === model.id
      requestEpoch.current += 1
      setBusyAction({ modelId: model.id, type: 'delete' })
      setError(null)
      try {
        setSetup(await operations.delete(model.id))
        if (deletedSelectedModel) {
          setModelDrawerOpen(false)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setBusyAction(null)
      }
    },
    [operations, setup?.selectedModelId]
  )

  const enabled = setup?.enabled ?? false
  const selectedModel = setup?.models.find((model) => model.id === setup.selectedModelId)
  const selectedModelLabel = selectedModel?.label ?? '未选择'
  const dictationMode = setup?.dictationMode === 'hold' ? 'hold' : 'toggle'

  return (
    <View style={styles.screen}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={() => onBack()}
          />
        }
        title="语音"
      />

      {!operations ? (
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
                testID="voice-enabled"
                accessibilityLabel="启用语音听写"
                value={enabled}
                onValueChange={(value) => void configure({ enabled: value })}
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
                onValueChange={(value) => void configure({ dictationMode: value })}
                options={DICTATION_MODES}
                value={dictationMode}
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
