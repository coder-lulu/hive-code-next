import { Stack } from 'expo-router'
import { MobileHomeProvider } from '../../src/home/MobileHomeProvider'
import { useMobileTheme } from '../../src/theme/mobile-theme-provider'

export const unstable_settings = { initialRouteName: 'index' }

export default function MainLayout() {
  const theme = useMobileTheme()
  return (
    <MobileHomeProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.color.bg.canvas }
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="devices" />
      </Stack>
    </MobileHomeProvider>
  )
}
