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
  const router = useRouter()
  const { hydrated, session, signOut } = useMobileAuthSession()
  const signedIn = hydrated && session !== null

  return (
    <FutureFeatureScreen
      capabilityId="account"
      title={`${APP_DISPLAY_NAME} 账号`}
      description={productNameText(
        `管理 ${APP_DISPLAY_NAME} 用户资料与账号安全。Agent 账号仍在已连接电脑的独立页面中管理。`
      )}
    >
      <FutureFeatureNotice
        title={!hydrated ? '正在读取登录状态' : signedIn ? '已登录' : '尚未登录'}
      >
        {!hydrated
          ? '正在读取安全存储中的登录状态。'
          : signedIn
            ? `手机号已验证，当前设备可以使用 ${APP_DISPLAY_NAME} 云端账号。`
            : `使用手机号登录或注册 ${APP_DISPLAY_NAME} 云端账号。`}
      </FutureFeatureNotice>

      <FutureFeatureSection title="账号资料">
        <FutureFeatureRow
          label="昵称"
          value={signedIn ? session.account.displayName : '登录后设置'}
        />
        <FutureFeatureRow label="手机号" value={signedIn ? '已绑定' : '尚未绑定'} />
      </FutureFeatureSection>

      <FutureFeatureSection title="账号操作">
        <FutureFeatureRow
          label={signedIn ? '当前账号' : '登录或注册'}
          detail={signedIn ? session.account.displayName : '打开原生手机号登录表单'}
          onPress={signedIn ? undefined : () => router.push('/login')}
        />
        <FutureFeatureRow
          destructive
          disabled={!signedIn}
          label="退出登录"
          value={signedIn ? '清除本机登录态' : '当前未登录'}
          onPress={signedIn ? () => void signOut() : undefined}
        />
      </FutureFeatureSection>

      <FutureFeatureSection title="账号与数据">
        <FutureFeatureRow
          destructive
          label="注销账号"
          detail="服务接入前不会执行删除"
          onPress={() => router.push('/account/delete')}
        />
      </FutureFeatureSection>
    </FutureFeatureScreen>
  )
}
