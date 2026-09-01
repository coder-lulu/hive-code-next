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
  StyleSheet,
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
import { useRefreshHostClient } from '../src/transport/client-context'
import { decodePairingUrl, parsePairingCode } from '../src/transport/pairing'
import {
  startPreProfilePairing,
  type PreProfilePairingAttempt
} from '../src/transport/pre-profile-pairing-coordinator'
import { recoverMobileRelayPairing } from '../src/transport/mobile-relay-pairing-recovery'
import type { ConnectionLogEntry, PairingOffer } from '../src/transport/types'

const PAIRING_OVERALL_TIMEOUT_MS = 25_000
const SCAN_RETICLE_SCALE = 0.3
const SCAN_RETICLE_MAX_SIZE = 64

export default function PairScanScreen() {
  const router = useRouter()
  const refreshHostClient = useRefreshHostClient()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
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

    let recovery
    try {
      recovery = await recoverMobileRelayPairing()
    } catch (error) {
      if (pairingIsCurrent()) {
        console.warn('[pair] pairing recovery failed', error)
        setStatus('error')
        setErrorMessage(
          `无法恢复上一次配对：${error instanceof Error ? error.message : String(error)}`
        )
        processingRef.current = false
      }
      return
    }
    if (!pairingIsCurrent()) {
      return
    }
    if (recovery === 'deferred') {
      setStatus('error')
      setErrorMessage('上一次配对仍在安全恢复中，请检查网络后重试。')
      processingRef.current = false
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

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.color.bg.canvas },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space16
    },
    scrollCentered: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space24
    },
    scannerContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.space20,
      paddingTop: 0
    },
    cameraStage: {
      width: '100%',
      maxWidth: 400,
      minHeight: 470,
      alignItems: 'center',
      justifyContent: 'center'
    },
    cameraWrap: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    cameraPlaceholder: { flex: 1, backgroundColor: theme.color.bg.subtle },
    camera: { ...StyleSheet.absoluteFillObject },
    reticle: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center'
    },
    reticleFrame: { position: 'relative' },
    corner: {
      position: 'absolute',
      width: theme.spacing.space16,
      height: theme.spacing.space16,
      borderColor: theme.color.brand.primary
    },
    cornerTL: {
      top: 0,
      left: 0,
      borderTopWidth: 3,
      borderLeftWidth: 3,
      borderTopLeftRadius: theme.radii.small
    },
    cornerTR: {
      top: 0,
      right: 0,
      borderTopWidth: 3,
      borderRightWidth: 3,
      borderTopRightRadius: theme.radii.small
    },
    cornerBL: {
      bottom: 0,
      left: 0,
      borderBottomWidth: 3,
      borderLeftWidth: 3,
      borderBottomLeftRadius: theme.radii.small
    },
    cornerBR: {
      right: 0,
      bottom: 0,
      borderRightWidth: 3,
      borderBottomWidth: 3,
      borderBottomRightRadius: theme.radii.small
    },
    scanTitle: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary,
      textAlign: 'center',
      marginTop: theme.spacing.space20
    },
    scanDescription: {
      ...theme.typography.meta,
      maxWidth: 340,
      color: theme.color.text.secondary,
      textAlign: 'center',
      marginTop: theme.spacing.space8
    },
    actions: { width: '100%', gap: theme.spacing.space8, marginTop: theme.spacing.space24 },
    bottomActions: { width: '100%', maxWidth: 400 },
    scanStatus: {
      width: '100%',
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12
    },
    scanStatusText: { ...theme.typography.label, color: theme.color.text.inverse },
    logSlot: { width: '100%', marginTop: theme.spacing.space20 }
  })
}
