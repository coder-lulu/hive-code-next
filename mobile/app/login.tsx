import { useCallback, useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { MobileLoginBottomSheet } from '../src/auth/MobileLoginBottomSheet'
import { MobileSmsLoginForm } from '../src/auth/MobileSmsLoginForm'
import { useMobileAuthSession } from '../src/auth/mobile-auth-session'
import {
  mobileLoginActionKey,
  mobileLoginMockupConfiguration,
  type MobileLoginAction
} from '../src/auth/mobile-login-presentation'

export default function LoginScreen() {
  const router = useRouter()
  const { signIn } = useMobileAuthSession()
  const [agreed, setAgreed] = useState(false)
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null)
  const [smsFormVisible, setSmsFormVisible] = useState(false)

  const handleAction = useCallback(async (action: MobileLoginAction) => {
    setBusyActionKey(mobileLoginActionKey(action))
    try {
      await Promise.resolve()
      if (action.kind === 'phone' || action.kind === 'register') {
        setSmsFormVisible(true)
      } else {
        Alert.alert('暂未开放', '该登录方式暂未开放，请使用手机号登录。')
      }
    } finally {
      setBusyActionKey(null)
    }
  }, [])

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
          configuration={mobileLoginMockupConfiguration}
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
