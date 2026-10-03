import { memo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ShieldQuestion, X } from 'lucide-react-native'
import { MobileMarkdown } from '../components/MobileMarkdown'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { MobileChatPermission } from './mobile-native-chat-permission'

function permissionTitle(title: string): string {
  if (title === 'Permission requested') {
    return '请求权限'
  }
  const allowMatch = /^Allow (.+)\?$/.exec(title)
  return allowMatch ? `允许 ${allowMatch[1]}？` : title
}

function permissionOptionLabel(label: string): string {
  const labels: Record<string, string> = {
    Allow: '允许',
    'Allow always': '始终允许',
    Deny: '拒绝',
    Yes: '是',
    No: '否'
  }
  return labels[label] ?? label
}

// Renders a detected agent permission ask as a card with tappable options.
// The first option is treated as the primary (allow) action and gets a filled
// accent button so the affirmative choice reads as distinct from the rest.
function MobileNativeChatPermissionImpl({
  permission,
  onRespond,
  onCancel
}: {
  permission: MobileChatPermission
  onRespond: (send: string) => Promise<boolean>
  onCancel?: (prompt?: NonNullable<MobileChatPermission['prompt']>) => Promise<boolean>
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const hasContext = Boolean(
    permission.description ||
    permission.decisionReason ||
    permission.blockedPath ||
    permission.matchedAskRule ||
    permission.subject ||
    permission.detail
  )
  const respond = async (send: string): Promise<void> => {
    if (submittingRef.current) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    const accepted = await onRespond(send)
    if (!accepted) {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  return (
    <View testID="native-chat-approval-card" style={styles.card}>
      <View style={styles.header}>
        <ShieldQuestion size={16} color={theme.color.brand.primary} strokeWidth={2} />
        <Text
          testID="native-chat-approval-title"
          style={styles.title}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {permissionTitle(permission.title)}
        </Text>
        {onCancel ? (
          <Pressable
            accessibilityLabel="取消权限请求"
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            hitSlop={8}
            style={({ pressed }) => [styles.cancel, pressed && !submitting && styles.optionPressed]}
            onPress={() => void onCancel(permission.prompt)}
            disabled={submitting}
          >
            <X size={16} color={theme.color.text.tertiary} />
          </Pressable>
        ) : null}
      </View>
      {hasContext ? (
        <ScrollView
          testID="native-chat-approval-content"
          style={styles.contentScroll}
          contentContainerStyle={styles.content}
          nestedScrollEnabled
        >
          {permission.description ? (
            <Text style={styles.detail}>{permission.description}</Text>
          ) : null}
          {permission.decisionReason ? (
            <Text style={styles.detail}>
              <Text style={styles.contextLabel}>Reason: </Text>
              {permission.decisionReason}
            </Text>
          ) : null}
          {permission.blockedPath ? (
            <Text style={styles.detail}>
              <Text style={styles.contextLabel}>Blocked path: </Text>
              {permission.blockedPath}
            </Text>
          ) : null}
          {permission.matchedAskRule ? (
            <Text style={styles.detail}>
              <Text style={styles.contextLabel}>Ask rule: </Text>
              {permission.matchedAskRule.ruleContent ?? permission.matchedAskRule.toolName}
              {' · '}
              {permission.matchedAskRule.source}
            </Text>
          ) : null}
          {permission.subject?.kind === 'plan' ? (
            <View>
              <MobileMarkdown content={permission.subject.text} />
              {permission.subject.filePath ? (
                <Text style={styles.planFile}>Plan file: {permission.subject.filePath}</Text>
              ) : null}
            </View>
          ) : permission.detail ? (
            <Text style={styles.detail}>{permission.detail}</Text>
          ) : null}
        </ScrollView>
      ) : null}
      <View testID="native-chat-approval-actions" style={styles.options}>
        {permission.options.map((option, index) => {
          const isPrimary = index === 0
          return (
            <Pressable
              key={`${option.send}:${option.label}`}
              style={({ pressed }) => [
                styles.option,
                isPrimary ? styles.optionPrimary : styles.optionSecondary,
                pressed && !submitting && styles.optionPressed
              ]}
              hitSlop={6}
              onPress={() => respond(option.send)}
              disabled={submitting}
              accessibilityRole="button"
            >
              <Text style={[styles.optionText, isPrimary && styles.optionTextPrimary]}>
                {permissionOptionLabel(option.label)}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export const MobileNativeChatPermission = memo(MobileNativeChatPermissionImpl)

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    card: {
      marginHorizontal: theme.spacing.space16,
      marginVertical: theme.spacing.space8,
      padding: theme.spacing.space16,
      gap: theme.spacing.space8,
      borderRadius: theme.radii.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      flexShrink: 1,
      minHeight: 0
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      flexShrink: 0
    },
    cancel: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center'
    },
    title: {
      ...theme.typography.sectionTitle,
      flex: 1,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    detail: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    planFile: {
      ...theme.typography.code,
      marginTop: theme.spacing.space8,
      color: theme.color.text.secondary
    },
    contextLabel: {
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    contentScroll: {
      maxHeight: theme.spacing.space64 * 4,
      minHeight: 0,
      flexShrink: 1
    },
    content: {
      gap: theme.spacing.space8
    },
    options: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.space8,
      flexShrink: 0
    },
    option: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    optionPrimary: {
      backgroundColor: theme.color.bg.selected
    },
    optionSecondary: {
      backgroundColor: theme.color.bg.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    optionPressed: {
      opacity: 0.7
    },
    optionText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    optionTextPrimary: {
      color: theme.color.text.inverse
    }
  })
}
