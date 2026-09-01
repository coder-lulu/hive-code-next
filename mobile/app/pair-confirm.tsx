import { productNameText } from '@/product-brand'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { AlertTriangle, ChevronLeft, Monitor, RefreshCw, ShieldCheck } from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { PairingActionButton } from '../src/components/pairing/PairingActionButton'
import { pairingEndpointLabel } from '../src/components/pairing/pairing-endpoint-label'
import {
  PairingConnectingState,
  PairingScreenContent,
  PairingSecurityNotice
} from '../src/components/pairing/PairingScreenContent'
import { MobileIconButton } from '../src/components/ui/MobileIconButton'
import { MobileScreenHeader } from '../src/components/ui/MobileScreenHeader'
import {
  loadMobileOnboardingSteps,
  mobileOnboardingDestination
} from '../src/onboarding/mobile-onboarding-plan'
import type { MobileTheme } from '../src/theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'
import { resolvePairConfirmRouteState } from '../src/transport/pair-confirm-state'
import {
  startPreProfilePairing,
  type PreProfilePairingAttempt
} from '../src/transport/pre-profile-pairing-coordinator'
import { recoverMobileRelayPairing } from '../src/transport/mobile-relay-pairing-recovery'
import { useRefreshHostClient } from '../src/transport/client-context'
import type { ConnectionLogEntry } from '../src/transport/types'

type Status = 'awaiting-confirm' | 'connecting' | 'error'

const PAIRING_OVERALL_TIMEOUT_MS = 25_000

export default function PairConfirmScreen() {
  const router = useRouter()
  const refreshHostClient = useRefreshHostClient()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const params = useLocalSearchParams<{ code?: string }>()
  const [status, setStatus] = useState<Status>('awaiting-confirm')
  const [errorMessage, setErrorMessage] = useState('')
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const mountedRef = useRef(true)
  const activePairingAttemptRef = useRef<PreProfilePairingAttempt | null>(null)
  const pairingGenerationRef = useRef(0)

  const routeState = resolvePairConfirmRouteState(params.code)
  const offer = routeState.offer
  const resolvedStatus =
    status === 'awaiting-confirm' && routeState.kind === 'error' ? 'error' : status
  const resolvedErrorMessage =
    status === 'awaiting-confirm' && routeState.kind === 'error'
      ? routeState.errorMessage
      : errorMessage

  const cancel = useCallback(() => {
    pairingGenerationRef.current += 1
    activePairingAttemptRef.current?.dispose()
    activePairingAttemptRef.current = null
    router.replace('/')
  }, [router])

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        cancel()
        return true
      })
      return () => subscription.remove()
    }, [cancel])
  )

  const setPairConfirmRootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      mountedRef.current = true
      return
    }
    activePairingAttemptRef.current?.dispose()
    activePairingAttemptRef.current = null
    pairingGenerationRef.current += 1
    mountedRef.current = false
  }, [])

  async function confirm() {
    if (!offer) {
      return
    }
    setStatus('connecting')
    setErrorMessage('')
    logsRef.current = []
    setLogs([])
    activePairingAttemptRef.current?.dispose()
    const pairingGeneration = ++pairingGenerationRef.current
    const pairingIsCurrent = () =>
      mountedRef.current && pairingGenerationRef.current === pairingGeneration

    let recovery
    try {
      recovery = await recoverMobileRelayPairing()
    } catch (error) {
      if (pairingIsCurrent()) {
        console.warn('[pair-confirm] pairing recovery failed', error)
        setStatus('error')
        setErrorMessage(
          `无法恢复上一次配对：${error instanceof Error ? error.message : String(error)}`
        )
      }
      return
    }
    if (!pairingIsCurrent()) {
      return
    }
    if (recovery === 'deferred') {
      setStatus('error')
      setErrorMessage('上一次配对仍在安全恢复中，请检查网络后重试。')
      return
    }

    const attempt = startPreProfilePairing({
      offer,
      timeoutMs: PAIRING_OVERALL_TIMEOUT_MS,
      connectOptions: {
        onLog: (entry) => {
          if (!pairingIsCurrent() || activePairingAttemptRef.current !== attempt) {
            return
          }
          logsRef.current = [...logsRef.current, entry]
          setLogs(logsRef.current)
        }
      }
    })
    activePairingAttemptRef.current = attempt
    try {
      const { hostId } = await attempt.result
      const attemptIsCurrent = pairingIsCurrent() && activePairingAttemptRef.current === attempt
      attempt.dispose()
      if (activePairingAttemptRef.current === attempt) {
        activePairingAttemptRef.current = null
      }
      if (!attemptIsCurrent) {
        return
      }
      refreshHostClient(hostId)
      const onboardingSteps = await loadMobileOnboardingSteps()
      if (!pairingIsCurrent()) {
        return
      }
      router.replace(mobileOnboardingDestination(onboardingSteps, hostId))
    } catch (error) {
      const timedOut = attempt.timedOut
      const attemptIsCurrent = pairingIsCurrent() && activePairingAttemptRef.current === attempt
      attempt.dispose()
      if (activePairingAttemptRef.current === attempt) {
        activePairingAttemptRef.current = null
      }
      if (!attemptIsCurrent) {
        return
      }
      console.warn('[pair-confirm] connect failed', error)
      setStatus('error')
      setErrorMessage(
        timedOut
          ? `连接在 ${PAIRING_OVERALL_TIMEOUT_MS / 1000} 秒内未完成，请查看下方日志后重试。`
          : `配对失败：${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const bottomPadding = { paddingBottom: insets.bottom + theme.spacing.space20 }

  return (
    <View ref={setPairConfirmRootRef} style={styles.container}>
      <MobileScreenHeader
        leading={
          <MobileIconButton accessibilityLabel="取消配对" icon={ChevronLeft} onPress={cancel} />
        }
        title="设备授权"
      />
      <ScrollView contentContainerStyle={[styles.content, bottomPadding]}>
        {offer && resolvedStatus === 'awaiting-confirm' ? (
          <PairingScreenContent
            description={productNameText('确认后，Orca 会保存这台电脑的配对凭据，并建立加密连接。')}
            icon={ShieldCheck}
            title="授权连接这台电脑？"
          >
            <View style={styles.deviceCard}>
              <View style={styles.deviceIcon}>
                <Monitor color={theme.color.text.primary} size={24} strokeWidth={1.75} />
              </View>
              <View style={styles.deviceCopy}>
                <Text style={styles.deviceTitle}>{productNameText('Orca 桌面端')}</Text>
                <Text numberOfLines={1} style={styles.deviceMeta}>
                  {pairingEndpointLabel(offer.endpoint)} ·{' '}
                  {offer.relay ? '安全中继可用' : '本地网络'}
                </Text>
              </View>
            </View>
            <PairingSecurityNotice />
            <View style={styles.actions}>
              <PairingActionButton
                icon={ShieldCheck}
                label="确认并连接"
                onPress={() => void confirm()}
              />
              <PairingActionButton label="取消" onPress={cancel} variant="secondary" />
            </View>
          </PairingScreenContent>
        ) : null}

        {resolvedStatus === 'connecting' ? (
          <PairingConnectingState description="正在验证设备身份并保存配对凭据…">
            {logs.length > 0 ? (
              <View style={styles.logSlot}>
                <ConnectionLog entries={logs} title="配对日志" />
              </View>
            ) : null}
          </PairingConnectingState>
        ) : null}

        {resolvedStatus === 'error' ? (
          <PairingScreenContent
            description={resolvedErrorMessage}
            icon={AlertTriangle}
            title="设备授权失败"
            tone="danger"
          >
            {logs.length > 0 ? (
              <View style={styles.logSlot}>
                <ConnectionLog entries={logs} title="配对日志" />
              </View>
            ) : null}
            <View style={styles.actions}>
              {offer ? (
                <PairingActionButton
                  icon={RefreshCw}
                  label="重试连接"
                  onPress={() => void confirm()}
                />
              ) : null}
              <PairingActionButton label="返回首页" onPress={cancel} variant="secondary" />
            </View>
          </PairingScreenContent>
        ) : null}
      </ScrollView>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.bg.canvas },
    content: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space24
    },
    deviceCard: {
      width: '100%',
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      marginTop: theme.spacing.space24,
      padding: theme.spacing.space16,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    deviceIcon: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    deviceCopy: { flex: 1, minWidth: 0 },
    deviceTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    deviceMeta: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    actions: { width: '100%', gap: theme.spacing.space8, marginTop: theme.spacing.space24 },
    logSlot: { width: '100%', marginTop: theme.spacing.space20 }
  })
}
