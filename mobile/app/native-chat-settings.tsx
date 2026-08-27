import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import {
  MobileGroupedList,
  MobileGroupedListRow,
  MobileIconButton,
  MobileScreenHeader
} from '../src/components/ui'
import { useMobileDefaultSessionViewPreference } from '../src/session/use-mobile-default-session-view-preference'
import type { MobileTheme } from '../src/theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../src/theme/mobile-theme-provider'

export default function NativeChatSettingsScreen(): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const { defaultView, setDefaultView } = useMobileDefaultSessionViewPreference()
  const chatDefault = defaultView === 'chat'

  return (
    <View style={styles.screen}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={() => router.back()}
          />
        }
        title="聊天界面"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.space32 }
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.description}>
          选择支持聊天界面的智能体会话在此设备上的默认打开方式。终端会显示原始命令行，聊天界面则以消息形式呈现；你仍可从单个会话的长按菜单中切换视图。
        </Text>

        <MobileGroupedList title="默认视图">
          <MobileGroupedListRow
            detail={chatDefault ? '已开启' : '已关闭'}
            title="默认以聊天界面打开"
            trailing={
              <Switch
                accessibilityLabel="默认以聊天界面打开"
                value={chatDefault}
                onValueChange={(next) => setDefaultView(next ? 'chat' : 'terminal')}
                trackColor={{
                  false: theme.color.bg.subtle,
                  true: theme.color.bg.selected
                }}
                thumbColor={chatDefault ? theme.color.text.inverse : theme.color.text.secondary}
              />
            }
          />
        </MobileGroupedList>
      </ScrollView>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    content: {
      gap: theme.spacing.space16,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20
    },
    description: { ...theme.typography.body, color: theme.color.text.secondary }
  })
}
