import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ScrollText,
  XCircle
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  startDiagnosticFetchTimeout,
  type DiagnosticFetchTimeout
} from '../src/diagnostics/diagnostic-fetch-timeout'
import {
  formatEndpoint,
  testHostReachability,
  unreachableHostDetail
} from '../src/diagnostics/host-reachability'
import { troubleshootCommonIssues } from '../src/diagnostics/troubleshoot-common-issues'
import { MobileIconButton, MobileScreenHeader } from '../src/components/ui'
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'
import { createTroubleshootScreenStyles } from '../src/settings/troubleshoot-screen-styles'
import { loadHosts } from '../src/transport/host-store'

type DiagnosticStatus = 'idle' | 'running' | 'done'

type CheckResult = {
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
}

function StatusIcon({ status }: { status: CheckResult['status'] }) {
  const theme = useMobileTheme()
  switch (status) {
    case 'pass':
      return <CheckCircle2 size={20} color={theme.color.status.success} strokeWidth={2} />
    case 'fail':
      return <XCircle size={20} color={theme.color.status.danger} strokeWidth={2} />
    case 'warn':
      return <AlertTriangle size={20} color={theme.color.status.warning} strokeWidth={2} />
  }
}

export default function TroubleshootScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createTroubleshootScreenStyles)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [diagnosticStatus, setDiagnosticStatus] = useState<DiagnosticStatus>('idle')
  const [checks, setChecks] = useState<CheckResult[]>([])
  const abortRef = useRef(false)
  const diagnosticRunRef = useRef(0)
  const activeInternetCheckRef = useRef<DiagnosticFetchTimeout | null>(null)

  const setTroubleshootRootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      return
    }
    // Why: diagnostics can outlive the screen; cancel the active run when the route detaches.
    abortRef.current = true
    diagnosticRunRef.current += 1
    activeInternetCheckRef.current?.dispose()
    activeInternetCheckRef.current = null
  }, [])

  const toggleSection = useCallback((id: string) => {
    setExpandedId((previous) => (previous === id ? null : id))
  }, [])

  const runDiagnostics = useCallback(async () => {
    const runId = diagnosticRunRef.current + 1
    diagnosticRunRef.current = runId
    abortRef.current = false
    activeInternetCheckRef.current?.dispose()
    activeInternetCheckRef.current = null
    setDiagnosticStatus('running')
    setChecks([])

    const results: CheckResult[] = []
    const isCurrentRun = () => !abortRef.current && diagnosticRunRef.current === runId

    try {
      const hosts = await loadHosts()
      results.push(
        hosts.length > 0
          ? { label: '已配对电脑', status: 'pass', detail: `${hosts.length} 台已配对` }
          : { label: '已配对电脑', status: 'fail', detail: '暂无，请扫描二维码配对' }
      )
    } catch {
      results.push({ label: '已配对电脑', status: 'warn', detail: '无法读取电脑数据' })
    }

    if (!isCurrentRun()) {
      return
    }
    setChecks([...results])

    const internetCheck = startDiagnosticFetchTimeout(5000)
    activeInternetCheckRef.current = internetCheck
    try {
      const response = await fetch('https://dns.google/resolve?name=example.com&type=A', {
        signal: internetCheck.signal
      })
      if (!isCurrentRun()) {
        return
      }
      results.push(
        response.ok
          ? { label: '互联网', status: 'pass', detail: '连接正常' }
          : { label: '互联网', status: 'warn', detail: '响应异常' }
      )
    } catch {
      if (!isCurrentRun()) {
        return
      }
      results.push({ label: '互联网', status: 'fail', detail: '无法连接' })
    } finally {
      internetCheck.dispose()
      if (activeInternetCheckRef.current === internetCheck) {
        activeInternetCheckRef.current = null
      }
    }

    if (!isCurrentRun()) {
      return
    }
    setChecks([...results])

    try {
      const hosts = await loadHosts()
      for (const host of hosts) {
        if (!isCurrentRun()) {
          return
        }
        const reachable = await testHostReachability(host.endpoint)
        if (!isCurrentRun()) {
          return
        }
        results.push({
          label: host.name,
          status: reachable ? 'pass' : 'fail',
          detail: reachable
            ? `可连接：${formatEndpoint(host.endpoint)}`
            : unreachableHostDetail(host.endpoint)
        })
        setChecks([...results])
      }
    } catch {
      results.push({ label: '电脑连接', status: 'warn', detail: '无法执行检测' })
    }

    if (!isCurrentRun()) {
      return
    }

    results.push({
      label: '平台',
      status: 'pass',
      detail: `${Platform.OS} ${Platform.Version ?? ''}`
    })

    setChecks([...results])
    setDiagnosticStatus('done')
  }, [])

  return (
    <View ref={setTroubleshootRootRef} style={styles.screen}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={() => router.back()}
          />
        }
        title="故障排查"
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.space32 }
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel={diagnosticStatus === 'done' ? '再次运行诊断' : '运行诊断'}
            accessibilityRole="button"
            accessibilityState={{
              busy: diagnosticStatus === 'running',
              disabled: diagnosticStatus === 'running'
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              diagnosticStatus === 'running' && styles.buttonDisabled
            ]}
            onPress={runDiagnostics}
            disabled={diagnosticStatus === 'running'}
          >
            {diagnosticStatus === 'running' ? (
              <ActivityIndicator size="small" color={theme.color.text.inverse} />
            ) : (
              <Activity size={20} color={theme.color.text.inverse} strokeWidth={2} />
            )}
            <Text maxFontSizeMultiplier={1.3} style={styles.primaryButtonLabel}>
              {diagnosticStatus === 'running'
                ? '正在诊断…'
                : diagnosticStatus === 'done'
                  ? '再次运行'
                  : '运行诊断'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityLabel="查看连接日志"
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed]}
            onPress={() => router.push('/connection-log')}
          >
            <ScrollText size={20} color={theme.color.text.secondary} strokeWidth={2} />
            <Text maxFontSizeMultiplier={1.3} style={styles.secondaryButtonLabel}>
              查看连接日志
            </Text>
          </Pressable>
        </View>

        {checks.length > 0 ? (
          <View>
            <Text maxFontSizeMultiplier={1.3} style={styles.groupTitle}>
              诊断结果
            </Text>
            <View accessibilityLiveRegion="polite" style={styles.group}>
              {checks.map((check, index) => (
                <View key={`${check.label}-${index}`}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.checkRow}>
                    <StatusIcon status={check.status} />
                    <View style={styles.checkCopy}>
                      <Text maxFontSizeMultiplier={1.3} style={styles.checkLabel}>
                        {check.label}
                      </Text>
                      <Text
                        maxFontSizeMultiplier={1.3}
                        style={[
                          styles.checkDetail,
                          check.status === 'fail' && styles.checkDetailFail,
                          check.status === 'warn' && styles.checkDetailWarn
                        ]}
                      >
                        {check.detail}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View>
          <Text maxFontSizeMultiplier={1.3} style={styles.groupTitle}>
            常见问题
          </Text>
          <View style={styles.group}>
            {troubleshootCommonIssues.map((section, index) => {
              const IssueIcon = section.icon
              const expanded = expandedId === section.id
              return (
                <View key={section.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    style={({ pressed }) => [
                      styles.accordionHeader,
                      pressed && styles.secondaryPressed
                    ]}
                    onPress={() => toggleSection(section.id)}
                  >
                    <IssueIcon size={20} color={theme.color.text.secondary} strokeWidth={2} />
                    <Text maxFontSizeMultiplier={1.3} style={styles.accordionTitle}>
                      {section.title}
                    </Text>
                    {expanded ? (
                      <ChevronUp size={20} color={theme.color.text.tertiary} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={20} color={theme.color.text.tertiary} strokeWidth={2} />
                    )}
                  </Pressable>
                  {expanded ? (
                    <View style={styles.accordionBody}>
                      {section.steps.map((step) => (
                        <View key={step} style={styles.stepRow}>
                          <View style={styles.bulletDot} />
                          <Text maxFontSizeMultiplier={1.3} style={styles.stepText}>
                            {step}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              )
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
