import { Monitor, RefreshCw } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { MobileGroupedList, MobileGroupedListRow } from '../components/ui/MobileGroupedList'
import type { RuntimeSelectorEntry } from '../runtime-directory/runtime-selector-presentation'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { HostCatalogEntry } from '../transport/types'
import { createMobileHomeConnectionStyles } from './mobile-home-connection-styles'

export function MobileHomeAccountComputers(props: {
  entries: readonly RuntimeSelectorEntry[]
  computers: readonly HostCatalogEntry[]
  loading: boolean
  error: string | null
  empty: boolean
  onRefresh: () => void
  onOpen: (host: HostCatalogEntry) => void
}) {
  const styles = useMobileThemeStyles(createMobileHomeConnectionStyles)
  const theme = useMobileTheme()
  return (
    <View style={styles.panelCopy}>
      {props.entries.length > 0 ? (
        <MobileGroupedList accessibilityLabel="账号中的电脑">
          {props.entries.map((entry) => (
            <MobileGroupedListRow
              key={entry.id}
              accessibilityLabel={`连接${entry.name}，${entry.statusLabel}`}
              busy={entry.statusLabel === '连接中' || entry.statusLabel === '正在重连'}
              title={entry.name}
              value={entry.statusLabel}
              disabled={!entry.selectable}
              leading={<Monitor size={20} strokeWidth={2} color={theme.color.text.secondary} />}
              onPress={() => {
                const computer = props.computers.find((host) => host.id === entry.id)
                if (entry.selectable && computer) {
                  props.onOpen(computer)
                }
              }}
            />
          ))}
        </MobileGroupedList>
      ) : null}
      {props.empty ? (
        <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
          还没有已认领的电脑。请在电脑端登录同一账号并发起认领。
        </Text>
      ) : null}
      {props.error ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          电脑列表获取失败：{props.error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="刷新账号电脑"
        accessibilityState={{ busy: props.loading, disabled: props.loading }}
        disabled={props.loading}
        onPress={props.onRefresh}
        style={({ pressed }) => [
          styles.refresh,
          pressed && styles.pressed,
          props.loading && styles.disabled
        ]}
      >
        <RefreshCw size={16} strokeWidth={2} color={theme.color.text.secondary} />
        <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.hint}>
          {props.loading ? '正在获取电脑…' : '刷新账号电脑'}
        </Text>
      </Pressable>
    </View>
  )
}
