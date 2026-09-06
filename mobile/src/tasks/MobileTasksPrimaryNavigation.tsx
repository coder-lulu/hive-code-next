import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  MobilePrimaryNavigation,
  type MobilePrimaryDestination
} from '../components/MobilePrimaryNavigation'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { leaveHostRoute } from '../host-route-exit'
import { useMobileTheme } from '../theme/mobile-theme-provider'

export function MobileTasksPrimaryNavigation(props: { readonly hostId: string }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isWideLayout } = useResponsiveLayout()
  const theme = useMobileTheme()

  if (isWideLayout) {
    return null
  }

  function selectDestination(destination: MobilePrimaryDestination) {
    if (destination === 'tasks') {
      leaveHostRoute(router)
      return
    }
    if (destination === 'workspace') {
      router.replace(`/h/${props.hostId}`)
      return
    }
    const unavailableCopy = {
      agents: 'HiveAgent 角色与行业目录的数据契约尚未接入。',
      library: '资料库索引尚未接入当前 Runtime。',
      automation: '自动化编排服务尚未接入当前 Runtime。'
    }[destination]
    Alert.alert('功能接入中', unavailableCopy)
  }

  return (
    <MobilePrimaryNavigation
      active="tasks"
      bottomInset={insets.bottom}
      onSelect={selectDestination}
      theme={theme}
    />
  )
}
