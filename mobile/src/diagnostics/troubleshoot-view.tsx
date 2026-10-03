import { useCallback, useState, type ReactNode } from 'react'
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Activity,
  CheckCircle2,
  ScrollText,
  XCircle,
  AlertTriangle
} from 'lucide-react-native'
import { MobileIconButton, MobileScreenHeader } from '../components/ui'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { troubleshootCommonIssues } from './troubleshoot-common-issues'
import { createTroubleshootScreenStyles } from './troubleshoot-screen-styles'
export type DiagnosticStatus = 'idle' | 'running' | 'done'

export type CheckResult = {
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
}

function StatusIcon({ status }: { status: CheckResult['status'] }) {
  const theme = useMobileTheme()
  switch (status) {
    case 'pass':
      return <CheckCircle2 size={14} color={theme.color.status.success} />
    case 'fail':
      return <XCircle size={14} color={theme.color.status.danger} />
    case 'warn':
      return <AlertTriangle size={14} color={theme.color.text.tertiary} />
  }
}

export function TroubleshootView({
  rootRef,
  diagnosticStatus,
  checks,
  runDiagnostics,
  onBack,
  onConnectionLog,
  developerRow
}: {
  rootRef?: (node: View | null) => void
  diagnosticStatus: DiagnosticStatus
  checks: CheckResult[]
  runDiagnostics: () => void
  onBack: () => void
  onConnectionLog: () => void
  /** Slot the route fills in a development build and in an OTA build; null in a native build. */
  developerRow?: ReactNode
}) {
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createTroubleshootScreenStyles)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const toggleSection = useCallback(
    (id: string) => setExpandedId((prev) => (prev === id ? null : id)),
    []
  )
  return (
    <View ref={rootRef} style={styles.container}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={onBack}
          />
        }
        title="故障排查"
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + theme.spacing.space32 }
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={({ pressed }) => [
            styles.diagnosticButton,
            pressed && styles.diagnosticButtonPressed,
            diagnosticStatus === 'running' && styles.diagnosticButtonDisabled
          ]}
          accessibilityLabel="运行网络诊断"
          accessibilityRole="button"
          accessibilityState={{
            disabled: diagnosticStatus === 'running',
            busy: diagnosticStatus === 'running'
          }}
          testID="diagnostics-run"
          onPress={runDiagnostics}
          disabled={diagnosticStatus === 'running'}
        >
          {diagnosticStatus === 'running' ? (
            <ActivityIndicator size="small" color={theme.color.text.primary} />
          ) : (
            <Activity size={16} color={theme.color.text.primary} />
          )}
          <Text style={styles.diagnosticButtonLabel}>
            {diagnosticStatus === 'running'
              ? '正在诊断…'
              : diagnosticStatus === 'done'
                ? '重新诊断'
                : '运行诊断'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.diagnosticButton,
            pressed && styles.diagnosticButtonPressed
          ]}
          accessibilityLabel="查看网络诊断日志"
          accessibilityRole="button"
          onPress={onConnectionLog}
        >
          <ScrollText size={16} color={theme.color.text.primary} />
          <Text style={styles.diagnosticButtonLabel}>查看网络诊断</Text>
        </Pressable>

        {developerRow}

        {checks.length > 0 && (
          <View style={styles.section}>
            {checks.map((check, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.separator} />}
                <View style={styles.checkRow}>
                  <StatusIcon status={check.status} />
                  <Text style={styles.checkLabel}>{check.label}</Text>
                  <Text
                    style={[styles.checkDetail, check.status === 'fail' && styles.checkDetailFail]}
                  >
                    {check.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionHeading}>常见问题</Text>

        <View style={styles.section}>
          {troubleshootCommonIssues.map((section, i) => {
            const Icon = section.icon
            const expanded = expandedId === section.id

            return (
              <View key={section.id}>
                {i > 0 && <View style={styles.separator} />}
                <Pressable
                  accessibilityLabel={section.title}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  style={({ pressed }) => [styles.accordionHeader, pressed && styles.rowPressed]}
                  onPress={() => toggleSection(section.id)}
                >
                  <Icon size={20} strokeWidth={1.8} color={theme.color.text.tertiary} />
                  <Text style={styles.accordionTitle}>{section.title}</Text>
                  {expanded ? (
                    <ChevronUp size={16} color={theme.color.text.tertiary} />
                  ) : (
                    <ChevronDown size={16} color={theme.color.text.tertiary} />
                  )}
                </Pressable>
                {expanded && (
                  <View style={styles.accordionBody}>
                    {section.steps.map((step, j) => (
                      <View key={j} style={styles.stepRow}>
                        <Text style={styles.bullet}>•</Text>
                        <Text style={styles.stepText}>{step}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )
          })}
        </View>

        <View style={{ height: theme.spacing.space32 }} />
      </ScrollView>
    </View>
  )
}
