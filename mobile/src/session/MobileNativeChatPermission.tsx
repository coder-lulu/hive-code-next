import { memo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ShieldQuestion } from 'lucide-react-native'
import { approvalBlockedPathToShow } from '../../../src/shared/agent-session-approval-blocked-path'
import { MobileNativeChatCardHeaderAction } from './MobileNativeChatCardHeaderAction'
import { MobileMarkdown } from '../components/MobileMarkdown'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import {
  isNewerApprovalSubject,
  isPlanApprovalSubject
} from '../../../src/shared/agent-session-approval-subject'
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
  onCancel,
  onCollapse
}: {
  permission: MobileChatPermission
  onRespond: (send: string) => Promise<boolean>
  onCancel?: (prompt?: NonNullable<MobileChatPermission['prompt']>) => Promise<boolean>
  /** Fold the card to a strip and free Send, writing nothing. */
  onCollapse?: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  // A newer Orca's subject: its detail is shown, and only the card's cancel answers.
  const newerSubject = isNewerApprovalSubject(permission.subject)
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
        <MobileNativeChatCardHeaderAction
          prompt={permission.prompt}
          onCancel={onCancel}
          onCollapse={onCollapse}
          disabled={submitting}
        />
      </View>
      <MobileNativeChatPermissionContext permission={permission} newerSubject={newerSubject} />
      <View testID="native-chat-approval-actions" style={styles.options}>
        {permission.options.map((option, index) => {
          const isPrimary = index === 0
          return (
            <Pressable
              key={`${option.send}:${option.label}`}
              style={({ pressed }) => [
                styles.option,
                isPrimary ? styles.optionPrimary : styles.optionSecondary,
                pressed && !submitting && styles.optionPressed,
                newerSubject && styles.disabled
              ]}
              hitSlop={6}
              onPress={() => respond(option.send)}
              disabled={submitting || newerSubject}
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

function MobileNativeChatPermissionContext({
  permission,
  newerSubject
}: {
  permission: MobileChatPermission
  newerSubject: boolean
}): React.JSX.Element | null {
  const styles = useMobileThemeStyles(createStyles)
  const neededPath = approvalBlockedPathToShow(permission)
  if (
    !permission.description &&
    !permission.decisionReason &&
    !neededPath &&
    !permission.subject &&
    !permission.detail
  ) {
    return null
  }
  return (
    <ScrollView
      testID="native-chat-approval-content"
      style={styles.contentScroll}
      contentContainerStyle={styles.content}
      nestedScrollEnabled
    >
      {permission.description ? <Text style={styles.detail}>{permission.description}</Text> : null}
      {permission.decisionReason ? (
        <Text style={styles.detail}>
          <Text style={styles.contextLabel}>原因：</Text>
          {permission.decisionReason}
        </Text>
      ) : null}
      {neededPath ? (
        <Text style={styles.detail}>
          <Text style={styles.contextLabel}>需要访问：</Text>
          {neededPath}
        </Text>
      ) : null}
      {isPlanApprovalSubject(permission.subject) ? (
        <View>
          <MobileMarkdown content={permission.subject.text} />
          {permission.subject.filePath ? (
            <Text style={styles.planFile}>计划文件：{permission.subject.filePath}</Text>
          ) : null}
        </View>
      ) : permission.detail ? (
        <Text style={styles.detail}>{permission.detail}</Text>
      ) : null}
      {newerSubject ? (
        <Text testID="native-chat-approval-needs-newer-orca" style={styles.detail}>
          此请求包含当前 HiveCode 不支持的内容。
        </Text>
      ) : null}
    </ScrollView>
  )
}

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
    disabled: { opacity: 0.5 },
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
