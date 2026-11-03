import { useMobileTranslation } from '../i18n/use-mobile-translation'
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
  const t = useMobileTranslation()

  const styles = useMobileThemeStyles(createMobileHomeConnectionStyles)
  const theme = useMobileTheme()
  return (
    <View style={styles.panelCopy}>
      {props.entries.length > 0 ? (
        <MobileGroupedList
          accessibilityLabel={t(
            'auto.mobile.src.home.MobileHomeAccountComputers.71d807d73d',
            'Computers in your account'
          )}
        >
          {props.entries.map((entry) => (
            <MobileGroupedListRow
              key={entry.id}
              accessibilityLabel={t(
                'auto.mobile.src.home.MobileHomeAccountComputers.a820e741bb',
                'Connect to {{value0}}, {{value1}}',
                { value0: entry.name, value1: entry.statusLabel }
              )}
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
          {t(
            'auto.mobile.src.home.MobileHomeAccountComputers.a47a79d9b4',
            'No computers claimed yet. Sign in to the same account on your computer and start a claim.'
          )}
        </Text>
      ) : null}
      {props.error ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          {t(
            'auto.mobile.src.home.MobileHomeAccountComputers.13830414d1',
            'Could not load the computer list: '
          )}
          {props.error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(
          'auto.mobile.src.home.MobileHomeAccountComputers.5e260adf7a',
          'Refresh account computers'
        )}
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
          {props.loading
            ? t('auto.mobile.src.home.MobileHomeAccountComputers.5eac5ed38a', 'Loading computers…')
            : t(
                'auto.mobile.src.home.MobileHomeAccountComputers.5e260adf7a',
                'Refresh account computers'
              )}
        </Text>
      </Pressable>
    </View>
  )
}
