import { productNameText } from '@/product-brand'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import {
  AlertTriangle,
  ChevronLeft,
  ClipboardPaste,
  QrCode,
  RefreshCw,
  Settings
} from 'lucide-react-native'
import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { PairingActionButton } from '../src/components/pairing/PairingActionButton'
import { PairingCodeSheet } from '../src/components/pairing/PairingCodeSheet'
import { resolvePairScanCameraSize } from '../src/components/pairing/pair-scan-camera-size'
import { createPairScanScreenStyles } from '../src/components/pairing/pair-scan-screen-styles'
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
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'
import { useRefreshHostClient } from '../src/transport/client-context'
import { decodePairingUrl, parsePairingCode } from '../src/transport/pairing'
import {
  startPreProfilePairing,
  type PreProfilePairingAttempt
} from '../src/transport/pre-profile-pairing-coordinator'
import type { ConnectionLogEntry, PairingOffer } from '../src/transport/types'

const PAIRING_OVERALL_TIMEOUT_MS = 25_000
const SCAN_RETICLE_SCALE = 0.3
const SCAN_RETICLE_MAX_SIZE = 64

export default function PairScanScreen() {
  const router = useRouter()
  const refreshHostClient = useRefreshHostClient()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createPairScanScreenStyles)
  const viewportWidth = useWindowDimensions().width
  const [permission, requestPermission] = useCameraPermissions()
  const [status, setStatus] = useState<'scanning' | 'connecting' | 'error'>('scanning')
  const [errorMessage, setErrorMessage] = useState('')
  const [pasteVisible, setPasteVisible] = useState(false)
  const [cameraBounds, setCameraBounds] = useState({ width: 0, height: 0 })
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const processingRef = useRef(false)
  const mountedRef = useRef(true)
  const activePairingAttemptRef = useRef<PreProfilePairingAttempt | null>(null)
  const pairingGenerationRef = useRef(0)

  const setPairScanRootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      mountedRef.current = true
      return
    }
    activePairingAttemptRef.current?.dispose()
    activePairingAttemptRef.current = null
    pairingGenerationRef.current += 1
    mountedRef.current = false
  }, [])

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    if (processingRef.current) {
      return
    }
    processingRef.current = true
    const offer = decodePairingUrl(data)
    if (!offer) {
      setStatus('error')
      setErrorMessage(productNameText('Not a valid Orca QR code'))
      processingRef.current = false
      return
    }
    void testAndSave(offer)
  }, [])

  const handlePasteSubmit = useCallback((input: string) => {
    setPasteVisible(false)
    if (processingRef.current) {
      return
    }
    processingRef.current = true
    const offer = parsePairingCode(input)
    if (!offer) {
      setStatus('error')
      setErrorMessage(productNameText('配对码无效，请从电脑版 Orca 重新复制后再试。'))
      processingRef.current = false
      return
    }
    void testAndSave(offer)
  }, [])

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const nextBounds = { width: Math.round(width), height: Math.round(height) }
    setCameraBounds((currentBounds) =>
      currentBounds.width === nextBounds.width && currentBounds.height === nextBounds.height
        ? currentBounds
        : nextBounds
    )
  }, [])

  async function testAndSave(offer: PairingOffer) {
    setStatus('connecting')
    logsRef.current = []
    setLogs([])
    activePairingAttemptRef.current?.dispose()
    const pairingGeneration = ++pairingGenerationRef.current
    const pairingIsCurrent = () =>
      mountedRef.current && pairingGenerationRef.current === pairingGeneration

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
      console.warn('[pair] connect failed', error)
      setStatus('error')
      setErrorMessage(
        timedOut
          ? `连接在 ${PAIRING_OVERALL_TIMEOUT_MS / 1000} 秒内未完成，请查看下方日志后重试。`
          : `配对失败：${error instanceof Error ? error.message : String(error)}`
      )
      processingRef.current = false
    }
  }

  function retry() {
    pairingGenerationRef.current += 1
    activePairingAttemptRef.current?.dispose()
    activePairingAttemptRef.current = null
    setStatus('scanning')
    setErrorMessage('')
    logsRef.current = []
    setLogs([])
    processingRef.current = false
  }

  const reticleSize = Math.min(
    Math.round(Math.min(cameraBounds.width, cameraBounds.height) * SCAN_RETICLE_SCALE),
    SCAN_RETICLE_MAX_SIZE
  )
  const cameraSize = resolvePairScanCameraSize(viewportWidth, theme.spacing.space20)
  const bottomPadding = { paddingBottom: insets.bottom + theme.spacing.space20 }
  const header = (
    <MobileScreenHeader
      leading={
        <MobileIconButton
          accessibilityLabel="返回"
          icon={ChevronLeft}
          onPress={() => {
            pairingGenerationRef.current += 1
            activePairingAttemptRef.current?.dispose()
            activePairingAttemptRef.current = null
            processingRef.current = false
            router.back()
          }}
        />
      }
      title="连接电脑"
    />
  )

  if (!permission) {
    return (
      <View ref={setPairScanRootRef} style={styles.container}>
        {header}
        <View style={styles.centered}>
          <ActivityIndicator color={theme.color.text.secondary} size="large" />
          <Text style={styles.loadingText}>正在准备相机…</Text>
        </View>
      </View>
    )
  }

  if (!permission.granted) {
    const canAskAgain = permission.canAskAgain !== false
    return (
      <View ref={setPairScanRootRef} style={styles.container}>
        {header}
        <ScrollView contentContainerStyle={[styles.scrollCentered, bottomPadding]}>
          <PairingScreenContent
            description={
              canAskAgain
                ? productNameText(
                    '允许相机访问以扫描电脑版 Orca 显示的二维码，也可以直接输入配对码。'
                  )
                : productNameText(
                    '请在系统设置中开启相机权限，或直接输入电脑版 Orca 显示的配对码。'
                  )
            }
            icon={QrCode}
            title={canAskAgain ? '扫描桌面端二维码' : '相机权限已关闭'}
          >
            <View style={styles.actions}>
              <PairingActionButton
                icon={canAskAgain ? QrCode : Settings}
                label={canAskAgain ? '允许相机访问' : '打开系统设置'}
                onPress={canAskAgain ? requestPermission : () => void Linking.openSettings()}
              />
              <PairingActionButton
                icon={ClipboardPaste}
                label="输入配对码"
                onPress={() => setPasteVisible(true)}
                variant="secondary"
              />
            </View>
            <PairingSecurityNotice />
          </PairingScreenContent>
        </ScrollView>
        <PairingCodeSheet
          onCancel={() => setPasteVisible(false)}
          onSubmit={handlePasteSubmit}
          visible={pasteVisible}
        />
      </View>
    )
  }

  return (
    <View ref={setPairScanRootRef} style={styles.container}>
      {header}
      {status === 'scanning' ? (
        <ScrollView contentContainerStyle={[styles.scannerContent, bottomPadding]}>
          <View style={styles.cameraStage}>
            <View
              accessibilityLabel="二维码扫描区域"
              onLayout={handleCameraLayout}
              style={[styles.cameraWrap, { width: cameraSize, height: cameraSize }]}
            >
              {!pasteVisible ? (
                <CameraView
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  facing="back"
                  onBarcodeScanned={handleBarCodeScanned}
                  style={styles.camera}
                />
              ) : (
                <View style={styles.cameraPlaceholder} />
              )}
              <View pointerEvents="none" style={styles.reticle}>
                <View style={[styles.reticleFrame, { width: reticleSize, height: reticleSize }]}>
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
              </View>
            </View>
            <Text accessibilityRole="header" style={styles.scanTitle}>
              扫描桌面端二维码
            </Text>
            <Text style={styles.scanDescription}>
              二维码只用于交换配对信息，不包含你的代码内容。
            </Text>
          </View>
          <View style={styles.bottomActions}>
            <View
              accessibilityLiveRegion="polite"
              accessibilityRole="text"
              style={styles.scanStatus}
            >
              <QrCode color={theme.color.text.inverse} size={20} strokeWidth={2} />
              <Text style={styles.scanStatusText}>正在扫描</Text>
            </View>
            <PairingActionButton
              label="无法使用相机？"
              onPress={() => setPasteVisible(true)}
              variant="ghost"
            />
          </View>
        </ScrollView>
      ) : null}

      {status === 'connecting' ? (
        <ScrollView contentContainerStyle={[styles.scrollCentered, bottomPadding]}>
          <PairingConnectingState>
            {logs.length > 0 ? (
              <View style={styles.logSlot}>
                <ConnectionLog entries={logs} title="配对日志" />
              </View>
            ) : null}
          </PairingConnectingState>
        </ScrollView>
      ) : null}

      {status === 'error' ? (
        <ScrollView contentContainerStyle={[styles.scrollCentered, bottomPadding]}>
          <PairingScreenContent
            description={errorMessage}
            icon={AlertTriangle}
            title="无法连接电脑"
            tone="danger"
          >
            {logs.length > 0 ? (
              <View style={styles.logSlot}>
                <ConnectionLog entries={logs} title="配对日志" />
              </View>
            ) : null}
            <View style={styles.actions}>
              <PairingActionButton icon={RefreshCw} label="重新扫描" onPress={retry} />
              <PairingActionButton
                icon={ClipboardPaste}
                label="输入配对码"
                onPress={() => {
                  retry()
                  setPasteVisible(true)
                }}
                variant="secondary"
              />
            </View>
          </PairingScreenContent>
        </ScrollView>
      ) : null}

      <PairingCodeSheet
        onCancel={() => setPasteVisible(false)}
        onSubmit={handlePasteSubmit}
        visible={pasteVisible}
      />
    </View>
  )
}
