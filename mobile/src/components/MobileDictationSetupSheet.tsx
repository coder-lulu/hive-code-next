import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { Check, Download } from 'lucide-react-native'
import { BottomDrawer } from './BottomDrawer'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { RpcClient } from '../transport/rpc-client'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { useDictationSetupPoller } from '../dictation/use-dictation-setup-poller'
import {
  downloadDictationModel,
  fetchDictationSetup,
  isModelInFlight,
  setDictationConfig,
  type MobileSpeechModel,
  type MobileSpeechSetup
} from '../dictation/mobile-dictation-setup'

const POLL_INTERVAL_MS = 1500

type Props = {
  visible: boolean
  client: RpcClient | null
  onClose: () => void
  // Called after the user reaches a ready+enabled state, so the caller can retry.
  onReady?: () => void
}

function formatSize(bytes: number | null | undefined): string {
  if (!bytes) {
    return ''
  }
  return `${Math.round(bytes / 1_000_000)} MB`
}

// Lets the user enable dictation and download a speech model on the paired
// desktop, from the phone. Polls while a download is in flight.
export function MobileDictationSetupSheet({ visible, client, onClose, onReady }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [setup, setSetup] = useState<MobileSpeechSetup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
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
      setError(err instanceof Error ? err.message : 'Failed to load')
      return undefined
    }
  }, [client])

  const polling = setup?.models.some(isModelInFlight) ?? false
  const refreshSetup = useDictationSetupPoller({
    visible: visible && client !== null,
    polling,
    refresh,
    intervalMs: POLL_INTERVAL_MS
  })

  useEffect(() => {
    if (visible) {
      setError(null)
    }
  }, [visible])

  const handleDownload = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      setBusy(model.id)
      setError(null)
      try {
        await downloadDictationModel(client, model.id)
        await refreshSetup()
      } catch (err) {
        triggerError()
        setError(err instanceof Error ? err.message : 'Download failed')
      } finally {
        setBusy(null)
      }
    },
    [client, refreshSetup]
  )

  const handleUseModel = useCallback(
    async (model: MobileSpeechModel) => {
      if (!client) {
        return
      }
      setBusy(model.id)
      setError(null)
      try {
        const next = await setDictationConfig(client, { enabled: true, modelId: model.id })
        setSetup(next)
        triggerSuccess()
        onReady?.()
      } catch (err) {
        triggerError()
        setError(err instanceof Error ? err.message : 'Could not select model')
      } finally {
        setBusy(null)
      }
    },
    [client, onReady]
  )

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!client) {
        return
      }
      setError(null)
      try {
        setSetup(await setDictationConfig(client, { enabled }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update')
      }
    },
    [client]
  )

  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      {/* Why: BottomDrawer already scrolls its children in a keyboard-aware container;
          a nested capped ScrollView cut off the lower controls. */}
      <View>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.heading}>
          Set up voice dictation
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
          Download a model and enable dictation on your desktop — all from here.
        </Text>

        {setup === null ? (
          <View style={styles.loading}>
            <ActivityIndicator
              accessibilityLabel="Loading voice dictation setup"
              color={theme.color.text.secondary}
            />
          </View>
        ) : (
          <>
            <View style={styles.enableRow}>
              <Text maxFontSizeMultiplier={1.3} style={styles.enableLabel}>
                Dictation enabled
              </Text>
              <Switch
                accessibilityLabel="Dictation enabled"
                accessibilityState={{ checked: setup.enabled }}
                ios_backgroundColor={theme.color.bg.subtle}
                thumbColor={theme.color.bg.surface}
                trackColor={{
                  false: theme.color.bg.subtle,
                  true: theme.color.bg.selected
                }}
                value={setup.enabled}
                onValueChange={(value) => void handleToggleEnabled(value)}
              />
            </View>

            <View style={styles.models}>
              {setup.models.map((model, index) => {
                const isSelected = model.id === setup.selectedModelId
                const inFlight = isModelInFlight(model)
                const rowBusy = busy === model.id
                return (
                  <View key={model.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <View style={styles.modelRow}>
                      <View style={styles.modelInfo}>
                        <View style={styles.modelTitleRow}>
                          <Text maxFontSizeMultiplier={1.3} style={styles.modelLabel}>
                            {model.label}
                          </Text>
                          {model.recommended ? (
                            <View style={styles.recommendedBadge}>
                              <Text maxFontSizeMultiplier={1.3} style={styles.recommended}>
                                Recommended
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text maxFontSizeMultiplier={1.3} style={styles.modelMeta}>
                          {model.provider === 'openai' ? 'OpenAI API' : formatSize(model.sizeBytes)}
                          {inFlight && model.progress != null
                            ? ` · ${Math.round(model.progress * 100)}%`
                            : model.status === 'extracting'
                              ? ' · extracting…'
                              : ''}
                        </Text>
                      </View>
                      {model.provider === 'openai' ? (
                        <Text maxFontSizeMultiplier={1.3} style={styles.modelStateText}>
                          {model.status === 'ready' ? 'API key set' : 'Set up on desktop'}
                        </Text>
                      ) : model.status === 'ready' ? (
                        isSelected ? (
                          <View
                            accessibilityLabel={`${model.label}, in use`}
                            accessibilityRole="text"
                            style={styles.selectedTag}
                          >
                            <Check size={16} color={theme.color.status.success} strokeWidth={2} />
                            <Text maxFontSizeMultiplier={1.3} style={styles.selectedText}>
                              In use
                            </Text>
                          </View>
                        ) : (
                          <Pressable
                            accessibilityLabel={`Use voice model ${model.label}`}
                            accessibilityRole="button"
                            accessibilityState={{ busy: rowBusy, disabled: rowBusy }}
                            style={({ pressed }) => [
                              styles.actionButton,
                              pressed && styles.actionPressed,
                              rowBusy && styles.disabled
                            ]}
                            disabled={rowBusy}
                            onPress={() => void handleUseModel(model)}
                          >
                            {rowBusy ? (
                              <ActivityIndicator size="small" color={theme.color.text.secondary} />
                            ) : (
                              <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>
                                Use
                              </Text>
                            )}
                          </Pressable>
                        )
                      ) : inFlight ? (
                        <ActivityIndicator
                          accessibilityLabel={`Downloading voice model ${model.label}`}
                          size="small"
                          color={theme.color.text.secondary}
                        />
                      ) : (
                        <Pressable
                          accessibilityLabel={`Download voice model ${model.label}`}
                          accessibilityRole="button"
                          accessibilityState={{ busy: rowBusy, disabled: rowBusy }}
                          style={({ pressed }) => [
                            styles.actionButton,
                            pressed && styles.actionPressed,
                            rowBusy && styles.disabled
                          ]}
                          disabled={rowBusy}
                          onPress={() => void handleDownload(model)}
                        >
                          {rowBusy ? (
                            <ActivityIndicator size="small" color={theme.color.text.secondary} />
                          ) : (
                            <>
                              <Download
                                size={16}
                                color={theme.color.text.secondary}
                                strokeWidth={2}
                              />
                              <Text maxFontSizeMultiplier={1.3} style={styles.actionText}>
                                Download
                              </Text>
                            </>
                          )}
                        </Pressable>
                      )}
                    </View>
                  </View>
                )
              })}
            </View>
          </>
        )}
        {error ? (
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </BottomDrawer>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    heading: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    subtitle: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4,
      marginBottom: theme.spacing.space16
    },
    loading: { paddingVertical: theme.spacing.space24, alignItems: 'center' },
    enableRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface,
      marginBottom: theme.spacing.space12
    },
    enableLabel: {
      ...theme.typography.body,
      flex: 1,
      color: theme.color.text.primary
    },
    models: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
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
    modelTitleRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    modelLabel: { ...theme.typography.body, color: theme.color.text.primary },
    recommendedBadge: {
      paddingHorizontal: theme.spacing.space8,
      paddingVertical: theme.spacing.space4,
      borderRadius: theme.radii.small,
      backgroundColor: theme.color.bg.subtle
    },
    recommended: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      fontWeight: '500'
    },
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
    actionButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space12,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    actionPressed: { backgroundColor: theme.color.bg.subtle },
    disabled: { opacity: 0.4 },
    actionText: {
      ...theme.typography.label,
      color: theme.color.text.primary
    },
    selectedTag: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4
    },
    selectedText: {
      ...theme.typography.meta,
      color: theme.color.status.successText
    },
    error: {
      ...theme.typography.meta,
      color: theme.color.status.dangerText,
      marginTop: theme.spacing.space12
    }
  })
}
