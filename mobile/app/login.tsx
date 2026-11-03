import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { MobileLoginBottomSheet } from '../src/auth/MobileLoginBottomSheet'
import { MobileSmsLoginForm } from '../src/auth/MobileSmsLoginForm'
import { useMobileAuthSession } from '../src/auth/mobile-auth-session'
import { loadMobileLoginConfiguration } from '../src/auth/mobile-login-capabilities'
import {
  mobileLoginFallbackConfiguration,
  mobileLoginActionKey,
  type MobileLoginAction
} from '../src/auth/mobile-login-presentation'
import {
  beginMobileProviderLogin,
  mobileProviderLoginErrorMessage
} from '../src/auth/mobile-provider-auth'

export default function LoginScreen() {
  const router = useRouter()
  const { signIn } = useMobileAuthSession()
  const [agreed, setAgreed] = useState(false)
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null)
  const [smsFormVisible, setSmsFormVisible] = useState(false)
  const [configuration, setConfiguration] = useState(mobileLoginFallbackConfiguration)
  const actionInFlightRef = useRef(false)

  useEffect(() => {
    let active = true
    void loadMobileLoginConfiguration().then((next) => {
      if (active) {
        setConfiguration(next)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const handleAction = useCallback(
    async (action: MobileLoginAction) => {
      if (actionInFlightRef.current) {
        return
      }
      actionInFlightRef.current = true
      setBusyActionKey(mobileLoginActionKey(action))
      try {
        await Promise.resolve()
        if (action.kind === 'phone' || action.kind === 'register') {
          setSmsFormVisible(true)
        } else {
          const provider = configuration.providers.find(({ id }) => id === action.providerId)
          if (!provider) {
            return
          }
          await beginMobileProviderLogin(provider, agreed)
        }
      } catch (failure) {
        Alert.alert('登录失败', mobileProviderLoginErrorMessage(failure))
      } finally {
        actionInFlightRef.current = false
        setBusyActionKey(null)
      }
    },
    [agreed, configuration.providers]
  )

  return (
    <>
      {smsFormVisible ? (
        <MobileSmsLoginForm
          onClose={() => setSmsFormVisible(false)}
          onSuccess={(session) => {
            signIn(session)
            setSmsFormVisible(false)
            router.replace('/')
          }}
          termsAccepted={agreed}
        />
      ) : (
        <MobileLoginBottomSheet
          agreed={agreed}
          busyActionKey={busyActionKey}
          configuration={configuration}
          onAction={(action) => void handleAction(action)}
          onAgreementChange={setAgreed}
          onAgreementRequired={() =>
            Alert.alert('请先同意协议', '请阅读并同意《服务协议》和《隐私政策》后继续。')
          }
          onClose={() => router.back()}
          onOpenPrivacy={() => router.push({ pathname: '/legal', params: { document: 'privacy' } })}
          onOpenTerms={() => router.push({ pathname: '/legal', params: { document: 'terms' } })}
        />
      )}
    </>
  )
}
