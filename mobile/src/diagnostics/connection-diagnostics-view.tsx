import type { ReactNode } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, Copy, Check, Send } from 'lucide-react-native'
import { MobileIconButton, MobileScreenHeader } from '../components/ui'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { APP_DISPLAY_NAME } from '../product-brand'
import { ConnectionLog } from '../components/ConnectionLog'
import { createConnectionDiagnosticsScreenStyles } from './connection-diagnostics-screen-styles'
import type { ConnectionLogEntry, ConnectionState } from '../transport/types'
import type { ConnectionDiagnosis } from './connection-diagnostics-analysis'
import type { DiagnosticsSubmissionState } from './connection-diagnostics-screen-data'

export function ConnectionDiagnosticsView({
  hostPicker,
  hasHost,
  hostName,
  state,
  reconnectAttempts,
  copied,
  copyDiagnostics,
  diagnosis,
  submissionState,
  sendDiagnostics,
  entries,
  onBack
}: {
  hostPicker?: ReactNode
  hasHost: boolean
  hostName: string
  state: ConnectionState
  reconnectAttempts: number
  copied: boolean
  copyDiagnostics: () => Promise<void>
  diagnosis: ConnectionDiagnosis | null
  submissionState: DiagnosticsSubmissionState | 'idle'
  sendDiagnostics: () => Promise<void>
  entries: readonly ConnectionLogEntry[]
  onBack: () => void
}) {
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createConnectionDiagnosticsScreenStyles)
  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: insets.bottom + theme.spacing.space20
        }
      ]}
    >
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={onBack}
          />
        }
        title="网络诊断"
      />
      <View style={styles.content}>
        {hostPicker}
        {hasHost ? (
          <>
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>
                {state}
                {reconnectAttempts > 0 ? ` · attempt ${reconnectAttempts}` : ''}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="复制诊断报告"
                style={styles.copyButton}
                onPress={() => void copyDiagnostics()}
              >
                {copied ? (
                  <Check size={14} color={theme.color.status.success} />
                ) : (
                  <Copy size={14} color={theme.color.text.secondary} />
                )}
                <Text style={styles.copyButtonText}>{copied ? '已复制' : '复制报告'}</Text>
              </Pressable>
            </View>
            {diagnosis && (
              <View style={styles.diagnosisCard}>
                <Text style={styles.diagnosisHeading}>What this suggests</Text>
                <Text style={styles.diagnosisText}>{diagnosis.likelyCause}</Text>
                <Text style={styles.diagnosisNext}>{diagnosis.nextStep}</Text>
                {diagnosis.reportability === 'orca-relay' && (
                  <>
                    <Text style={styles.privacyHint}>
                      Sends a size-limited redacted report including host name, endpoint, versions,
                      connection state, and events—never terminal contents or credentials.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="发送诊断报告"
                      accessibilityState={{
                        disabled: submissionState === 'sending',
                        busy: submissionState === 'sending'
                      }}
                      style={styles.sendButton}
                      onPress={() => void sendDiagnostics()}
                      disabled={submissionState === 'sending'}
                    >
                      {submissionState === 'sent' ? (
                        <Check size={14} color={theme.color.status.success} />
                      ) : (
                        <Send size={14} color={theme.color.text.primary} />
                      )}
                      <Text style={styles.sendButtonText}>
                        {submissionState === 'sending'
                          ? 'Sending…'
                          : submissionState === 'sent'
                            ? 'Diagnostics sent'
                            : submissionState === 'failed'
                              ? 'Retry sending'
                              : `发送诊断到 ${APP_DISPLAY_NAME}`}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
            {entries.length > 0 ? (
              <ConnectionLog entries={[...entries]} title={hostName} fillAvailableHeight />
            ) : (
              <Text style={styles.emptyText}>
                No connection events yet. Events appear as the app dials this host.
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.emptyText}>No paired hosts.</Text>
        )}
      </View>
    </View>
  )
}
