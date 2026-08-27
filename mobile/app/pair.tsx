import { productNameText } from '@/product-brand'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { AlertTriangle, ChevronLeft } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PairingActionButton } from '../src/components/pairing/PairingActionButton'
import {
  PairingConnectingState,
  PairingScreenContent
} from '../src/components/pairing/PairingScreenContent'
import { MobileIconButton } from '../src/components/ui/MobileIconButton'
import { MobileScreenHeader } from '../src/components/ui/MobileScreenHeader'
import type { MobileTheme } from '../src/theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'
import { extractPairingCodeFromUrl } from '../src/transport/pairing'

export default function PairRedirectScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string }>()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [missingCode, setMissingCode] = useState(false)

  const goHome = useCallback(() => {
    router.replace('/')
  }, [router])

  useEffect(() => {
    let disposed = false

    async function redirectToConfirm() {
      const codeParam = Array.isArray(params.code) ? params.code[0] : params.code
      if (codeParam) {
        router.replace({ pathname: '/pair-confirm', params: { code: codeParam } })
        return
      }

      const initialUrl = await Linking.getInitialURL().catch(() => null)
      const code = initialUrl ? extractPairingCodeFromUrl(initialUrl) : null
      if (disposed) {
        return
      }
      if (code) {
        router.replace({ pathname: '/pair-confirm', params: { code } })
        return
      }
      setMissingCode(true)
    }

    void redirectToConfirm()
    return () => {
      disposed = true
    }
  }, [params.code, router])

  const bottomPadding = { paddingBottom: insets.bottom + theme.spacing.space20 }
  return (
    <View style={styles.container}>
      <MobileScreenHeader
        leading={
          <MobileIconButton accessibilityLabel="返回首页" icon={ChevronLeft} onPress={goHome} />
        }
        title="设备授权"
      />
      <ScrollView contentContainerStyle={[styles.content, bottomPadding]}>
        {missingCode ? (
          <PairingScreenContent
            description={productNameText(
              '配对链接中没有有效的设备凭据，请返回电脑版 Orca 重新生成。'
            )}
            icon={AlertTriangle}
            title="配对链接无效"
            tone="danger"
          >
            <View style={styles.actions}>
              <PairingActionButton label="返回首页" onPress={goHome} />
            </View>
          </PairingScreenContent>
        ) : (
          <PairingConnectingState description="正在读取并校验设备凭据…" title="正在验证配对链接" />
        )}
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
    actions: { width: '100%', marginTop: theme.spacing.space24 }
  })
}
