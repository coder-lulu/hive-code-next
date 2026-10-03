import { SafeAreaView } from 'react-native-safe-area-context'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { useMobileHomeContext } from './mobile-home-context'
import { MobileHomeComputerList } from './MobileHomeComputerList'
import { MobileHomeToolbar } from './MobileHomeToolbar'
import { mobileHomeScreenStyles as styles } from './mobile-home-screen-styles'

export function MobileHomeScreen() {
  const theme = useMobileTheme()
  const { openMenu } = useMobileHomeContext()
  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.color.bg.canvas }]}
      edges={['top']}
    >
      <MobileHomeToolbar theme={theme} onOpenMenu={openMenu} />
      <MobileHomeComputerList />
    </SafeAreaView>
  )
}
