import { productNameText } from '@/product-brand'
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight, Globe } from 'lucide-react-native'
import { PickerModal, type PickerOption } from '../components/PickerModal'
import {
  MobileGroupedList,
  MobileGroupedListRow,
  MobileIconButton,
  MobileScreenHeader
} from '../components/ui'
import {
  loadTerminalLinkOpenMode,
  saveTerminalLinkOpenMode,
  type MobileTerminalLinkOpenMode
} from '../storage/preferences'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

const LINK_MODE_OPTIONS: PickerOption<MobileTerminalLinkOpenMode>[] = [
  {
    value: 'orca-browser',
    label: productNameText('Orca 桌面端浏览器'),
    subtitle: '在已配对电脑的流式浏览器中打开。'
  },
  {
    value: 'phone-browser',
    label: '手机浏览器',
    subtitle: '在此手机的 Safari、Chrome 或其他浏览器中打开。'
  }
]

function linkModeLabel(mode: MobileTerminalLinkOpenMode): string {
  return (
    LINK_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? LINK_MODE_OPTIONS[0]!.label
  )
}

export default function BrowserSettingsScreen({
  onBack
}: {
  onBack?: () => void
}): React.JSX.Element {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [linkMode, setLinkMode] = useState<MobileTerminalLinkOpenMode>('orca-browser')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadTerminalLinkOpenMode().then(
      (mode) => {
        if (active) {
          setLinkMode(mode)
        }
      },
      () => {
        if (active) {
          setError('无法加载浏览器偏好，请重试。')
        }
      }
    )
    return () => {
      active = false
    }
  }, [])

  const selectLinkMode = useCallback((mode: MobileTerminalLinkOpenMode) => {
    setError(null)
    setLinkMode(mode)
    void saveTerminalLinkOpenMode(mode).catch(() => setError('无法保存浏览器偏好，请重试。'))
  }, [])

  return (
    <View style={styles.screen}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={onBack ?? (() => router.back())}
          />
        }
        title="浏览器"
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.space32 }
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.description}>
          选择在终端输出中点按 HTTP(S) 链接时的打开位置。
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={styles.description}>
            {error}
          </Text>
        ) : null}
        <MobileGroupedList title="链接">
          <MobileGroupedListRow
            accessibilityLabel={`打开终端链接，当前为${linkModeLabel(linkMode)}`}
            detail={linkModeLabel(linkMode)}
            leading={<Globe color={theme.color.text.secondary} size={20} strokeWidth={2} />}
            onPress={() => setPickerOpen(true)}
            title="打开终端链接"
            trailing={<ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />}
          />
        </MobileGroupedList>
      </ScrollView>

      <PickerModal<MobileTerminalLinkOpenMode>
        visible={pickerOpen}
        title="打开终端链接"
        options={LINK_MODE_OPTIONS}
        selected={linkMode}
        onSelect={selectLinkMode}
        onClose={() => setPickerOpen(false)}
      />
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
