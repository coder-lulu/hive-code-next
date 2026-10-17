import type { ReactElement } from 'react'
import { ActivityIndicator, Pressable, Text } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import type { createMobileNativeChatViewStyles } from './mobile-native-chat-view-styles'

/** The "加载更早的消息" control, while older history remains. */
export function mobileNativeChatListHeader(
  hasMore: boolean | undefined,
  loadingEarlier: boolean | undefined,
  loadEarlier: () => void,
  theme: MobileTheme,
  styles: ReturnType<typeof createMobileNativeChatViewStyles>
): ReactElement | null {
  if (!hasMore) {
    return null
  }
  return (
    <Pressable style={styles.loadEarlier} onPress={loadEarlier} disabled={loadingEarlier}>
      {loadingEarlier ? (
        <ActivityIndicator size="small" color={theme.color.text.tertiary} />
      ) : (
        <Text style={styles.loadEarlierText}>Load earlier messages</Text>
      )}
    </Pressable>
  )
}
