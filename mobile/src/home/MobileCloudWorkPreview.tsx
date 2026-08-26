import { useMemo, useState } from 'react'
import {
  CircleEllipsis,
  FilePlus,
  FolderOpen,
  Mic,
  Plus,
  Send,
  Sparkles,
  SquareCode
} from 'lucide-react-native'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native'
import { resolveMobileFeatureCapability } from '../capabilities/mobile-feature-registry'
import { productNameText } from '../product-brand'
import type { MobileTheme } from '../theme/mobile-theme'

const GRAPHITE_MASCOT = require('../../assets/hivecode-mascot-graphite-cutout.png')

const HOME_TOOLS = [
  { id: 'new-task', label: '新建任务', Icon: FilePlus },
  { id: 'open-project', label: '打开项目', Icon: FolderOpen },
  { id: 'workspace', label: '工作区', Icon: SquareCode },
  { id: 'more', label: '更多', Icon: CircleEllipsis }
] as const

interface MobileCloudWorkPreviewProps {
  readonly theme: MobileTheme
  readonly bottomInset: number
  readonly onNewTask?: () => void
  readonly onOpenProject?: () => void
  readonly onOpenWorkspace?: () => void
  readonly onMore?: () => void
}

export function MobileCloudWorkPreview({
  bottomInset,
  onMore,
  onNewTask,
  onOpenProject,
  onOpenWorkspace,
  theme
}: MobileCloudWorkPreviewProps) {
  const { width: viewportWidth } = useWindowDimensions()
  const styles = useMemo(
    () => createStyles(theme, bottomInset, viewportWidth),
    [bottomInset, theme, viewportWidth]
  )
  const capability = resolveMobileFeatureCapability('cloudWork')
  const [draft, setDraft] = useState('')
  const [composerFocused, setComposerFocused] = useState(false)
  const [selectedTool, setSelectedTool] = useState<(typeof HOME_TOOLS)[number]['id'] | null>(null)
  const [focusedTool, setFocusedTool] = useState<(typeof HOME_TOOLS)[number]['id'] | null>(null)
  const [loadingTool, setLoadingTool] = useState<(typeof HOME_TOOLS)[number]['id'] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function explainPreview(nextTool?: (typeof HOME_TOOLS)[number]['id']) {
    if (nextTool) {
      setSelectedTool(nextTool)
    }
    setNotice(capability.unavailableReason)
  }

  function handleToolPress(toolId: (typeof HOME_TOOLS)[number]['id']) {
    const action = {
      'new-task': onNewTask,
      'open-project': onOpenProject,
      more: onMore,
      workspace: onOpenWorkspace
    }[toolId]
    if (action) {
      if (toolId === 'new-task') {
        setLoadingTool(toolId)
        setTimeout(() => setLoadingTool(null), 800)
      }
      action()
      return
    }
    explainPreview(toolId)
  }

  return (
    <View style={styles.screen} testID="cloud-work-preview">
      {!composerFocused ? (
        <View style={styles.hero}>
          <View
            accessibilityLabel={productNameText('Orca 小蜜蜂助手挥手并操作笔记本电脑')}
            style={styles.assistantVisual}
          >
            <Image source={GRAPHITE_MASCOT} resizeMode="contain" style={styles.mascot} />
          </View>
          <Text style={styles.title}>{productNameText('Orca，我帮你')}</Text>
          <Text style={styles.subtitle}>描述目标，我会在你的电脑上完成规划、编码与验证</Text>
        </View>
      ) : null}

      <View style={styles.bottomArea}>
        {!composerFocused ? (
          <ScrollView
            contentContainerStyle={styles.toolRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {HOME_TOOLS.map(({ id, label, Icon }) => {
              const selected = selectedTool === id
              const focused = focusedTool === id
              const loading = loadingTool === id
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityHint="当前仅提供界面预览"
                  accessibilityState={{ busy: loading, disabled: loading, selected }}
                  disabled={loading}
                  focusable
                  onBlur={() => setFocusedTool((current) => (current === id ? null : current))}
                  onFocus={() => setFocusedTool(id)}
                  onPress={() => handleToolPress(id)}
                  style={({ pressed }) => [
                    styles.toolCard,
                    selected && styles.toolCardSelected,
                    focused && styles.toolCardFocused,
                    pressed && styles.toolCardPressed
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color={theme.color.text.primary} size="small" />
                  ) : (
                    <Icon size={20} color={theme.color.text.primary} strokeWidth={1.9} />
                  )}
                  <Text numberOfLines={1} style={styles.toolLabel}>
                    {label}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}

        {notice ? (
          <View accessibilityLiveRegion="polite" style={styles.notice}>
            <Sparkles size={16} color={theme.color.text.primary} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <View style={styles.composer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="语音输入"
            accessibilityHint="云端工作接入后可用"
            onPress={() => explainPreview()}
            style={({ pressed }) => [styles.composerButton, pressed && styles.composerPressed]}
          >
            <Mic size={22} color={theme.color.text.primary} />
          </Pressable>
          <TextInput
            accessibilityLabel="云端工作消息"
            multiline
            onChangeText={setDraft}
            onBlur={() => setComposerFocused(false)}
            onFocus={() => {
              setComposerFocused(true)
              setNotice(null)
            }}
            placeholder="描述你想完成的任务…"
            placeholderTextColor={theme.color.text.tertiary}
            style={styles.input}
            value={draft}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={draft.trim() ? '发送消息' : '添加附件'}
            accessibilityHint="云端工作接入后可用"
            onPress={() => explainPreview()}
            style={({ pressed }) => [styles.sendButton, pressed && styles.sendButtonPressed]}
          >
            {draft.trim() ? (
              <Send size={21} color={theme.color.text.primary} strokeWidth={2} />
            ) : (
              <Plus size={24} color={theme.color.text.primary} strokeWidth={2.1} />
            )}
          </Pressable>
        </View>
        <Text style={styles.disclaimer}>代码在你的设备上执行</Text>
      </View>
    </View>
  )
}

function createStyles(theme: MobileTheme, bottomInset: number, viewportWidth: number) {
  const toolGap = theme.spacing.space8
  const toolCardWidth = Math.max(
    80,
    Math.floor(
      (viewportWidth - theme.spacing.space20 * 2 - toolGap * (HOME_TOOLS.length - 1)) /
        HOME_TOOLS.length
    )
  )
  const toolContentGap = toolCardWidth < 96 ? 6 : 8
  const toolHorizontalPadding = toolCardWidth < 96 ? 6 : 12

  return StyleSheet.create({
    screen: {
      flex: 1,
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.space16,
      paddingBottom: theme.spacing.space12 + bottomInset,
      backgroundColor: theme.color.bg.canvas
    },
    hero: {
      flex: 1,
      minHeight: 360,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.space12
    },
    assistantVisual: {
      width: 236,
      height: 236,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.space8,
      backgroundColor: 'transparent'
    },
    mascot: { width: 236, height: 236 },
    title: {
      ...theme.typography.display,
      color: theme.color.text.primary,
      textAlign: 'center'
    },
    subtitle: {
      ...theme.typography.label,
      marginTop: theme.spacing.space4,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    bottomArea: { gap: theme.spacing.space12 },
    toolRow: {
      flexDirection: 'row',
      gap: toolGap,
      paddingHorizontal: theme.spacing.space4
    },
    toolCard: {
      width: toolCardWidth,
      minHeight: 44,
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: toolContentGap,
      paddingHorizontal: toolHorizontalPadding,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: 10,
      backgroundColor: theme.color.bg.surface
    },
    toolCardSelected: {
      backgroundColor: theme.color.bg.subtle
    },
    toolCardFocused: {
      borderWidth: 1.5,
      borderColor: theme.color.brand.primary
    },
    toolCardPressed: {
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.subtle
    },
    toolLabel: {
      ...theme.typography.meta,
      color: theme.color.text.primary,
      fontWeight: '500',
      textAlign: 'center'
    },
    notice: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.overlay,
      backgroundColor: theme.color.bg.subtle
    },
    noticeText: { ...theme.typography.meta, flex: 1, color: theme.color.text.secondary },
    composer: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      padding: theme.spacing.space8,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface,
      shadowColor: '#000000',
      shadowOpacity: theme.scheme === 'dark' ? 0.24 : 0.09,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3
    },
    composerButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle
    },
    composerPressed: { backgroundColor: theme.color.bg.subtle },
    input: {
      ...theme.typography.body,
      minHeight: 44,
      maxHeight: 96,
      flex: 1,
      paddingHorizontal: theme.spacing.space4,
      paddingVertical: theme.spacing.space12,
      color: theme.color.text.primary
    },
    sendButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.circle,
      backgroundColor: 'transparent'
    },
    sendButtonPressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
    disclaimer: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      textAlign: 'center'
    }
  })
}
