import { useMobileTranslation } from '../src/i18n/use-mobile-translation'
import { APP_DISPLAY_NAME, productNameText } from '@/product-brand'
import { useRouter } from 'expo-router'
import { useMobileAuthSession } from '../src/auth/mobile-auth-session'
import {
  FutureFeatureNotice,
  FutureFeatureRow,
  FutureFeatureScreen,
  FutureFeatureSection
} from '../src/capabilities/FutureFeatureUI'

export default function AccountScreen() {
  const t = useMobileTranslation()

  const router = useRouter()
  const { hydrated, session, signOut } = useMobileAuthSession()
  const signedIn = hydrated && session !== null

  return (
    <FutureFeatureScreen
      capabilityId="account"
      title={t('auto.mobile.app.account.5caf89ca76', '{{value0}} account', {
        value0: APP_DISPLAY_NAME
      })}
      description={productNameText(
        `管理 ${APP_DISPLAY_NAME} 用户资料与账号安全。Agent 账号仍在已连接电脑的独立页面中管理。`
      )}
    >
      <FutureFeatureNotice
        title={
          !hydrated
            ? t('auto.mobile.app.account.1df5ee5401', 'Reading sign-in status')
            : signedIn
              ? t('auto.mobile.app.account.f67ddefeb8', 'Signed in')
              : t('auto.mobile.app.account.f28f2b3f50', 'Not signed in')
        }
      >
        {!hydrated
          ? t('auto.mobile.app.account.5a52e2551b', 'Reading sign-in status from secure storage.')
          : signedIn
            ? t(
                'auto.mobile.app.account.6a761b999e',
                'Your phone number is verified. This device can use your {{value0}} cloud account.',
                { value0: APP_DISPLAY_NAME }
              )
            : t(
                'auto.mobile.app.account.67994773aa',
                'Sign in or register for a {{value0}} cloud account with your phone number.',
                { value0: APP_DISPLAY_NAME }
              )}
      </FutureFeatureNotice>

      <FutureFeatureSection title={t('auto.mobile.app.account.54942977a0', 'Account profile')}>
        <FutureFeatureRow
          label={t('auto.mobile.app.account.e7686892e6', 'Nickname')}
          value={signedIn ? session.account.displayName : '登录后设置'}
        />
        <FutureFeatureRow
          label={t('auto.mobile.app.account.18e93c7caa', 'Phone number')}
          value={signedIn ? '已绑定' : '尚未绑定'}
        />
      </FutureFeatureSection>

      <FutureFeatureSection title={t('auto.mobile.app.account.fc44a0464f', 'Account actions')}>
        <FutureFeatureRow
          label={
            signedIn
              ? t('auto.mobile.app.account.97f017e00e', 'Current account')
              : t('auto.mobile.app.account.d955a7ebe1', 'Sign in or register')
          }
          detail={signedIn ? session.account.displayName : '打开原生手机号登录表单'}
          onPress={signedIn ? undefined : () => router.push('/login')}
        />
        <FutureFeatureRow
          destructive
          disabled={!signedIn}
          label={t('auto.mobile.app.account.96dc9158c7', 'Sign out')}
          value={signedIn ? '清除本机登录态' : '当前未登录'}
          onPress={signedIn ? () => void signOut() : undefined}
        />
      </FutureFeatureSection>

      <FutureFeatureSection title={t('auto.mobile.app.account.12cf8d7e8c', 'Account and data')}>
        <FutureFeatureRow
          destructive
          label={t('auto.mobile.app.account.1a4597a60b', 'Delete account')}
          detail="服务接入前不会执行删除"
          onPress={() => router.push('/account/delete')}
        />
      </FutureFeatureSection>
    </FutureFeatureScreen>
  )
}
