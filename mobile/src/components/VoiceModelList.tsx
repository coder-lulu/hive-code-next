import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Check, Download, Trash2 } from 'lucide-react-native'
import {
  isModelInFlight,
  type MobileSpeechModel,
  type MobileSpeechSetup
} from '../dictation/mobile-dictation-setup'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

type Props = {
  setup: MobileSpeechSetup
  disabled: boolean
  busyAction: { modelId: string; type: 'download' | 'select' | 'delete' } | null
  onUseModel: (model: MobileSpeechModel) => void
  onDownload: (model: MobileSpeechModel) => void
  onDelete: (model: MobileSpeechModel) => void
}

function formatSize(bytes: number | null): string {
  if (!bytes) {
    return ''
  }
  return `${Math.round(bytes / 1_000_000)} MB`
}

function modelMeta(model: MobileSpeechModel): string {
  if (model.provider === 'openai') {
    return 'OpenAI API'
  }
  const inFlight = isModelInFlight(model)
  if (inFlight && model.progress != null) {
    return `${formatSize(model.sizeBytes)} · ${Math.round(model.progress * 100)}%`
  }
  if (model.status === 'extracting') {
    return `${formatSize(model.sizeBytes)} · 正在解压…`
  }
  return formatSize(model.sizeBytes)
}

export function VoiceModelList({
  setup,
  disabled,
  busyAction,
  onUseModel,
  onDownload,
  onDelete
}: Props): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)

  return (
    <View style={disabled ? styles.disabled : undefined} pointerEvents={disabled ? 'none' : 'auto'}>
      {setup.models.map((model, index) => {
        const anyBusy = busyAction !== null
        const isSelected = model.id === setup.selectedModelId
        const inFlight = isModelInFlight(model)
        const rowBusy = busyAction?.modelId === model.id
        const selectBusy = rowBusy && busyAction?.type === 'select'
        const downloadBusy = rowBusy && busyAction?.type === 'download'
        const deleteBusy = rowBusy && busyAction?.type === 'delete'
        return (
          <View key={model.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <View style={styles.modelRow}>
              <View style={styles.modelInfo}>
                <View style={styles.modelTitleRow}>
                  <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.modelLabel}>
                    {model.label}
                  </Text>
                  {model.recommended ? (
                    <View style={styles.recommendedBadge}>
                      <Text maxFontSizeMultiplier={1.3} style={styles.recommendedText}>
                        推荐
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text maxFontSizeMultiplier={1.3} style={styles.modelMeta}>
                  {modelMeta(model)}
                </Text>
              </View>
              {model.provider === 'openai' ? (
                <Text maxFontSizeMultiplier={1.3} style={styles.modelStateText}>
                  {model.status === 'ready' ? '已设置 API 密钥' : '请在电脑端设置'}
                </Text>
              ) : model.status === 'ready' ? (
                <View style={styles.readyActions}>
                  {isSelected ? (
                    <View style={styles.selectedState}>
                      <Check size={16} color={theme.color.status.success} strokeWidth={2} />
                      <Text maxFontSizeMultiplier={1.3} style={styles.selectedText}>
                        使用中
                      </Text>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityLabel={`使用语音模型 ${model.label}`}
                      accessibilityRole="button"
                      accessibilityState={{ busy: selectBusy, disabled: anyBusy }}
                      style={({ pressed }) => [
                        styles.actionButton,
                        pressed && styles.actionPressed,
                        anyBusy && styles.disabled
                      ]}
                      disabled={anyBusy}
                      onPress={() => onUseModel(model)}
                    >
                      {selectBusy ? (
                        <ActivityIndicator size="small" color={theme.color.text.secondary} />
                      ) : (
                        <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>
                          使用
                        </Text>
                      )}
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityLabel={`删除语音模型 ${model.label}`}
                    accessibilityRole="button"
                    accessibilityState={{ busy: deleteBusy, disabled: anyBusy }}
                    style={({ pressed }) => [
                      styles.iconButton,
                      pressed && styles.actionPressed,
                      anyBusy && styles.disabled
                    ]}
                    disabled={anyBusy}
                    onPress={() => onDelete(model)}
                  >
                    {deleteBusy ? (
                      <ActivityIndicator size="small" color={theme.color.status.danger} />
                    ) : (
                      <Trash2 size={20} color={theme.color.status.danger} strokeWidth={2} />
                    )}
                  </Pressable>
                </View>
              ) : inFlight ? (
                <ActivityIndicator size="small" color={theme.color.text.secondary} />
              ) : (
                <Pressable
                  accessibilityLabel={`下载语音模型 ${model.label}`}
                  accessibilityRole="button"
                  accessibilityState={{ busy: downloadBusy, disabled: anyBusy }}
                  style={({ pressed }) => [
                    styles.iconButton,
                    pressed && styles.actionPressed,
                    anyBusy && styles.disabled
                  ]}
                  disabled={anyBusy}
                  onPress={() => onDownload(model)}
                >
                  {downloadBusy ? (
                    <ActivityIndicator size="small" color={theme.color.text.secondary} />
                  ) : (
                    <Download size={20} color={theme.color.text.secondary} strokeWidth={2} />
                  )}
                </Pressable>
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    disabled: { opacity: 0.4 },
    divider: {
      height: 1,
      marginLeft: theme.spacing.space16,
      backgroundColor: theme.color.border.subtle
    },
    modelRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    modelInfo: { flex: 1, minWidth: 0 },
    modelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space8 },
    modelLabel: {
      ...theme.typography.body,
      flexShrink: 1,
      color: theme.color.text.primary
    },
    recommendedBadge: {
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      borderRadius: theme.radii.small,
      backgroundColor: theme.color.bg.subtle
    },
    recommendedText: { ...theme.typography.caption, color: theme.color.text.secondary },
    modelMeta: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    },
    modelStateText: {
      ...theme.typography.meta,
      maxWidth: '40%',
      color: theme.color.text.secondary,
      textAlign: 'right'
    },
    readyActions: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space4 },
    selectedState: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    selectedText: { ...theme.typography.meta, color: theme.color.status.success },
    actionButton: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    actionPressed: { backgroundColor: theme.color.bg.subtle },
    actionText: { ...theme.typography.label, color: theme.color.text.primary },
    iconButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    }
  })
}
