import { useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Copy, TextSelect, X } from 'lucide-react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ActionSheetContent } from '../components/ActionSheetModal'
import { BottomDrawer } from '../components/BottomDrawer'
import { useClipboardWriter } from '../platform/clipboard'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { useReducedMotionEnabled } from '../hooks/use-reduced-motion-enabled'
import { nativeChatMessagePlainText } from './mobile-native-chat-message-plain-text'

type Props = {
  /** The long-pressed message. The owner mounts this only while the sheet is open. */
  message: NativeChatMessage
  onClose: () => void
}

export function MobileNativeChatMessageActionsSheet({
  message,
  onClose
}: Props): React.JSX.Element {
  const clipboard = useClipboardWriter()
  const [sheetVisible, setSheetVisible] = useState(true)
  const [selecting, setSelecting] = useState(false)
  // Wait for the drawer to unmount before presenting another native modal.
  const selectRequested = useRef(false)
  // Streaming updates must not reset an active native text selection.
  const [text] = useState(() => nativeChatMessagePlainText(message))
  const closeSheet = () => setSheetVisible(false)

  return (
    <>
      <BottomDrawer
        visible={sheetVisible}
        onClose={closeSheet}
        onAfterClose={() => (selectRequested.current ? setSelecting(true) : onClose())}
        dragContentToDismiss
      >
        <ActionSheetContent
          onClose={closeSheet}
          actions={[
            {
              label: '复制消息',
              icon: Copy,
              disabled: text.length === 0,
              onPress: () => {
                void clipboard.writeText(text).catch((error: unknown) => {
                  Alert.alert(
                    '复制失败',
                    error instanceof Error ? error.message : '剪贴板未接受该文本。'
                  )
                })
              }
            },
            {
              label: '选择文本',
              icon: TextSelect,
              disabled: text.length === 0,
              onPress: () => {
                selectRequested.current = true
              }
            }
          ]}
        />
      </BottomDrawer>
      {selecting ? <SelectTextScreen text={text} onClose={onClose} /> : null}
    </>
  )
}

function SelectTextScreen({
  text,
  onClose
}: {
  text: string
  onClose: () => void
}): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const reducedMotion = useReducedMotionEnabled()
  return (
    <Modal visible animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text style={styles.title}>选择文本</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel="关闭"
            accessibilityRole="button"
            style={styles.close}
          >
            <X size={20} color={theme.color.text.secondary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text selectable style={styles.text}>
            {text}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    title: { color: theme.color.text.primary, ...theme.typography.sectionTitle, fontWeight: '600' },
    close: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space4
    },
    body: { padding: theme.spacing.space20 },
    text: { color: theme.color.text.primary, ...theme.typography.body }
  })
}
