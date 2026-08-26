import { memo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ShieldQuestion } from 'lucide-react-native'
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
  onRespond
}: {
  permission: MobileChatPermission
  onRespond: (send: string) => Promise<boolean>
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
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
    <View style={styles.card}>
      <View style={styles.header}>
        <ShieldQuestion size={16} color={theme.color.brand.primary} strokeWidth={2} />
        <Text style={styles.title}>{permissionTitle(permission.title)}</Text>
      </View>
      {permission.detail ? <Text style={styles.detail}>{permission.detail}</Text> : null}
      <View style={styles.options}>
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
      backgroundColor: theme.color.bg.surface
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
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
    options: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.space8
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
