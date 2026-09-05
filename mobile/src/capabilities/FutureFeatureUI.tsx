import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Square,
  SquareCheckBig
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MobileGroupedList, MobileIconButton, MobileScreenHeader } from '../components/ui'
import { spacingTokens } from '../theme/mobile-theme'
import type { MobileFeatureId, ResolvedMobileFeatureCapability } from './mobile-feature-registry'
import { resolveProductMobileFeature } from './future-feature-state'
import { useFutureFeatureTheme } from './future-feature-theme'

export {
  FutureFeatureAction,
  FutureFeatureInput,
  FutureFeatureNotice,
  FutureFeatureSegmentedControl
} from './FutureFeatureControls'

function capabilityLabel(capability: ResolvedMobileFeatureCapability): string {
  switch (capability.status) {
    case 'live':
      return '可用'
    case 'ui-preview':
      return '界面预览'
    case 'configured':
      return capability.isAvailable ? '已配置' : '尚未配置'
    case 'unsupported':
      return '当前不支持'
    case 'removed':
      return '已移除'
  }
}

export interface FutureFeatureScreenProps {
  readonly capabilityId: MobileFeatureId
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}

export function FutureFeatureScreen({
  capabilityId,
  title,
  description,
  children
}: FutureFeatureScreenProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useFutureFeatureTheme()
  const capability = resolveProductMobileFeature(capabilityId)

  const goBack = () => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/settings')
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.color.bg.canvas }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={goBack}
          />
        }
        title={title}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoiding}
      >
        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            {
              gap: theme.spacing.space24,
              paddingHorizontal: theme.spacing.space20,
              paddingTop: theme.spacing.space20,
              paddingBottom: insets.bottom + theme.spacing.space32
            }
          ]}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            style={[
              styles.wrappingText,
              theme.typography.body,
              { color: theme.color.text.secondary }
            ]}
          >
            {description}
          </Text>
          <MobileGroupedList accessibilityLabel="功能状态">
            <FutureFeatureRow
              detail={capability.unavailableReason ?? undefined}
              label="功能状态"
              value={capabilityLabel(capability)}
            />
          </MobileGroupedList>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

export interface FutureFeatureSectionProps {
  readonly title: string
  readonly children: ReactNode
}

export function FutureFeatureSection({ title, children }: FutureFeatureSectionProps) {
  return <MobileGroupedList title={title}>{children}</MobileGroupedList>
}

export interface FutureFeatureRowProps {
  readonly label: string
  readonly value?: string
  readonly detail?: string
  readonly destructive?: boolean
  readonly disabled?: boolean
  readonly checked?: boolean
  readonly selected?: boolean
  readonly onPress?: () => void
}

export function FutureFeatureRow({
  label,
  value,
  detail,
  destructive = false,
  disabled = false,
  checked,
  selected,
  onPress
}: FutureFeatureRowProps) {
  const theme = useFutureFeatureTheme()
  const selectionIcon =
    checked === undefined
      ? selected === undefined
        ? null
        : selected
          ? CheckCircle2
          : Circle
      : checked
        ? SquareCheckBig
        : Square
  const SelectionIcon = selectionIcon
  const content = (
    <>
      {SelectionIcon ? (
        <SelectionIcon
          color={checked || selected ? theme.color.brand.primary : theme.color.text.tertiary}
          size={20}
          strokeWidth={1.8}
        />
      ) : null}
      <View style={styles.rowCopy}>
        <Text
          maxFontSizeMultiplier={1.3}
          style={[
            theme.typography.body,
            { color: destructive ? theme.color.status.dangerText : theme.color.text.primary }
          ]}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            maxFontSizeMultiplier={1.3}
            style={[theme.typography.meta, { color: theme.color.text.secondary }]}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={[styles.rowValue, theme.typography.meta, { color: theme.color.text.tertiary }]}
        >
          {value}
        </Text>
      ) : null}
      {onPress && checked === undefined && selected === undefined ? (
        <ChevronRight size={20} strokeWidth={1.8} color={theme.color.text.tertiary} />
      ) : null}
    </>
  )
  const rowStyle = {
    minHeight: theme.size.groupedListRowMinHeight,
    paddingHorizontal: theme.spacing.space16,
    paddingVertical: theme.spacing.space12,
    backgroundColor: theme.color.bg.surface
  }

  return onPress ? (
    <Pressable
      accessibilityLabel={[label, detail, value].filter(Boolean).join('，')}
      accessibilityRole={
        checked === undefined ? (selected === undefined ? 'button' : 'radio') : 'checkbox'
      }
      accessibilityState={{ checked, disabled, selected }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        rowStyle,
        disabled && styles.disabled,
        pressed && { backgroundColor: theme.color.bg.subtle }
      ]}
      onPress={onPress}
    >
      {content}
    </Pressable>
  ) : (
    <View style={[styles.row, rowStyle]}>{content}</View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%' },
  keyboardAvoiding: { flex: 1 },
  scroll: { flex: 1, width: '100%', maxWidth: '100%' },
  scrollContent: { width: '100%', maxWidth: '100%', alignSelf: 'stretch' },
  wrappingText: { flexShrink: 1, width: '100%' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.space12,
    minWidth: 0
  },
  rowCopy: { flex: 1, flexShrink: 1, gap: spacingTokens.space4 },
  rowValue: { maxWidth: '40%', flexShrink: 1, textAlign: 'right' },
  disabled: { opacity: 0.52 }
})
