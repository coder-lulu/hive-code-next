import { readNativeNotificationData } from '../src/notifications/native-notification-data'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Alert, View, StyleSheet } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import * as Notifications from 'expo-notifications'
import * as Linking from 'expo-linking'
import type { MobileTheme } from '../src/theme/mobile-theme'
import { MobileThemeProvider, useMobileTheme } from '../src/theme/mobile-theme-provider'
import { OrcaLogo } from '../src/components/OrcaLogo'
import { RpcClientProvider } from '../src/transport/client-context'
import { getNotificationNavigationTarget } from '../src/notifications/notification-routing'
import { useOpenNotificationRoute } from '../src/notifications/use-open-notification-route'
import { extractPairingCodeFromUrl } from '../src/transport/pairing'
import { MobileAuthSessionProvider, useMobileAuthSession } from '../src/auth/mobile-auth-session'
import {
  completeMobileProviderLogin,
  isMobileProviderCallbackUrl,
  isRetryableMobileProviderLoginFailure,
  mobileProviderLoginErrorMessage
} from '../src/auth/mobile-provider-auth'
import { MobileUpdateObserver } from '../src/update/MobileUpdateObserver'
import {
  AccountRuntimeDirectoryProvider,
  useAccountRuntimeDirectory
} from '../src/runtime-directory/account-runtime-directory-provider'
import { useAccountVisibleHostCatalog } from '../src/runtime-directory/use-account-visible-host-catalog'

// Why: keeps the native splash screen visible until the React tree is mounted
// and ready to render. Without this the user sees a blank white/black frame
// between the native splash and the first React paint.
SplashScreen.preventAutoHideAsync()

// Why: without this, expo-notifications silently drops notifications when
// the app is in the foreground. Setting all three to true makes iOS/Android
// display the banner, play the sound, and show the badge even while the
// app is active. This runs once at module load time before any notification
// is scheduled.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
})

export default function RootLayout() {
  return (
    <MobileThemeProvider>
      <MobileAuthSessionProvider>
        <ThemedRootLayout />
      </MobileAuthSessionProvider>
    </MobileThemeProvider>
  )
}

function ThemedRootLayout() {
  const router = useRouter()
  const { hydrated, signIn } = useMobileAuthSession()
  const handledProviderCallbackUrlsRef = useRef<Set<string>>(new Set())
  const pendingProviderCallbackUrlRef = useRef<string | null>(null)
  const theme = useMobileTheme()
  const styles = useMemo(() => createStyles(theme), [theme])

  // Why: route `hivecode://pair?...` deep links to the confirm screen so
  // the same pairing flow runs whether the link arrived via QR scan,
  // paste, AirDrop, Messages, or `xcrun simctl openurl`. getInitialURL
  // covers cold-start (link tapped while app was closed); the listener
  // covers warm-start (link tapped while app is in memory).
  useEffect(() => {
    let disposed = false

    function handleProviderCallback(url: string) {
      if (!hydrated) {
        pendingProviderCallbackUrlRef.current = url
        return
      }
      if (handledProviderCallbackUrlsRef.current.has(url)) {
        return
      }
      handledProviderCallbackUrlsRef.current.add(url)
      if (handledProviderCallbackUrlsRef.current.size > 16) {
        const oldest = handledProviderCallbackUrlsRef.current.values().next().value
        if (oldest !== undefined) {
          handledProviderCallbackUrlsRef.current.delete(oldest)
        }
      }
      void completeMobileProviderLogin(url)
        .then((session) => {
          if (!disposed) {
            signIn(session)
            router.replace('/')
          }
        })
        .catch((failure) => {
          if (isRetryableMobileProviderLoginFailure(failure)) {
            handledProviderCallbackUrlsRef.current.delete(url)
          }
          if (!disposed) {
            router.replace('/login')
            Alert.alert('登录失败', mobileProviderLoginErrorMessage(failure))
          }
        })
    }

    function handleUrl(url: string) {
      if (isMobileProviderCallbackUrl(url)) {
        handleProviderCallback(url)
        return
      }
      const code = extractPairingCodeFromUrl(url)
      if (code) {
        // Why: Android camera launches can leave Expo Router's unmatched
        // `hivecode://pair` route underneath this screen; replacing keeps cancel
        // and edge-back from revealing the router error page.
        router.replace({ pathname: '/pair-confirm', params: { code } })
      }
    }

    if (hydrated && pendingProviderCallbackUrlRef.current) {
      const pendingUrl = pendingProviderCallbackUrlRef.current
      pendingProviderCallbackUrlRef.current = null
      handleProviderCallback(pendingUrl)
    }

    void Linking.getInitialURL()
      .then((url) => {
        if (!disposed && url) {
          handleUrl(url)
        }
      })
      .catch(() => undefined)

    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url))
    return () => {
      disposed = true
      sub.remove()
    }
  }, [hydrated, router, signIn])

  // Why: hide the native splash only once the navigation Stack has been laid
  // out — this is the earliest moment the user will see actual app content.
  // Previously the splash hid when a placeholder View rendered, leaving a
  // grey gap before the real screen appeared.
  const onNavigatorLayout = useCallback(async () => {
    await SplashScreen.hideAsync()
  }, [])

  return (
    <RpcClientProvider>
      <AccountRuntimeDirectoryProvider>
        <AccountAwareNotificationResponseObserver />
        <View style={styles.root} onLayout={onNavigatorLayout}>
          <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.color.bg.surface },
              headerTintColor: theme.color.text.primary,
              headerTitleStyle: { fontSize: 16, fontWeight: '600' },
              contentStyle: { backgroundColor: theme.color.bg.canvas },
              headerShadowVisible: false
              // Why: deliberately no `orientation` screenOption. react-native-screens
              // has no value that respects the device rotation lock — even 'default'
              // calls setRequestedOrientation(UNSPECIFIED) at runtime, overriding the
              // manifest. Leaving it unset lets the manifest's "fullUser" (set by the
              // android-respect-rotation-lock config plugin) honor the auto-rotate lock.
            }}
          >
            <Stack.Screen
              name="index"
              options={{
                headerShown: false,
                headerTitle: () => <OrcaLogo size={22} />
              }}
            />
            <Stack.Screen name="pair-scan" options={{ headerShown: false }} />
            <Stack.Screen name="pair" options={{ headerShown: false }} />
            <Stack.Screen name="pair-confirm" options={{ headerShown: false }} />
            <Stack.Screen
              name="mobile-onboarding"
              options={{ headerShown: false, presentation: 'modal', gestureEnabled: false }}
            />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="account" options={{ headerShown: false }} />
            <Stack.Screen name="account/delete" options={{ headerShown: false }} />
            <Stack.Screen name="runtime-sessions" options={{ headerShown: false }} />
            <Stack.Screen
              name="login"
              options={{
                animation: 'fade',
                contentStyle: { backgroundColor: 'transparent' },
                headerShown: false,
                presentation: 'transparentModal'
              }}
            />
            <Stack.Screen name="privacy" options={{ headerShown: false }} />
            <Stack.Screen name="legal" options={{ headerShown: false }} />
            <Stack.Screen name="feedback" options={{ headerShown: false }} />
            <Stack.Screen name="storage" options={{ headerShown: false }} />
            <Stack.Screen name="terminal-settings" options={{ headerShown: false }} />
            <Stack.Screen name="native-chat-settings" options={{ headerShown: false }} />
            <Stack.Screen name="browser-settings" options={{ headerShown: false }} />
            <Stack.Screen name="voice-settings" options={{ headerShown: false }} />
            <Stack.Screen name="notifications" options={{ headerShown: false }} />
            <Stack.Screen name="troubleshoot" options={{ headerShown: false }} />
            <Stack.Screen name="connection-log" options={{ headerShown: false }} />
            <Stack.Screen name="about" options={{ headerShown: false }} />
            <Stack.Screen name="h" options={{ headerShown: false }} />
          </Stack>
        </View>
        <MobileUpdateObserver />
      </AccountRuntimeDirectoryProvider>
    </RpcClientProvider>
  )
}

function AccountAwareNotificationResponseObserver(): null {
  const openNotificationRoute = useOpenNotificationRoute()
  const { catalog, loaded } = useAccountVisibleHostCatalog()
  const { state: accountDirectory } = useAccountRuntimeDirectory()
  const catalogRef = useRef(catalog)
  const handledNotificationIdsRef = useRef<Set<string>>(new Set())
  catalogRef.current = catalog
  const catalogReady = loaded && accountDirectory.status !== 'loading'

  useEffect(() => {
    if (!catalogReady) {
      return
    }

    function clearLastNotificationResponse() {
      try {
        Notifications.clearLastNotificationResponse()
      } catch {
        // Older native shells may not expose the clear API; duplicate guards
        // still protect the current JS runtime.
      }
    }

    function handleNotificationResponse(response: Notifications.NotificationResponse) {
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
        clearLastNotificationResponse()
        return
      }

      const notificationId = response.notification.request.identifier
      if (handledNotificationIdsRef.current.has(notificationId)) {
        return
      }
      handledNotificationIdsRef.current.add(notificationId)
      if (handledNotificationIdsRef.current.size > 256) {
        const oldest = handledNotificationIdsRef.current.values().next().value
        if (oldest !== undefined) {
          handledNotificationIdsRef.current.delete(oldest)
        }
      }

      const hosts = catalogRef.current
      const target = getNotificationNavigationTarget(
        readNativeNotificationData(response.notification.request),
        {
          knownHostIds: new Set(hosts.map((host) => host.id)),
          credentialStatusByHostId: new Map(
            hosts.map((host) => [host.id, host.credentialStatus] as const)
          )
        }
      )
      clearLastNotificationResponse()
      if (target) {
        openNotificationRoute(target)
      }
    }

    let initialResponse: Notifications.NotificationResponse | null = null
    try {
      initialResponse = Notifications.getLastNotificationResponse()
    } catch {
      // A warm response listener below remains available on older native shells.
    }
    if (initialResponse) {
      handleNotificationResponse(initialResponse)
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    )
    return () => subscription.remove()
  }, [catalogReady, openNotificationRoute])

  return null
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    }
  })
}
