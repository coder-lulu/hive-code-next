import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { MobileTheme } from '../../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'
import type { RpcClient } from '../../transport/rpc-client'
import { triggerError, triggerSuccess } from '../../platform/haptics'
import { parseGitHubPrReference } from '../../source-control/github-pr-link-parse'
import { linkMobilePr } from '../../source-control/mobile-pr-link'

type Props = {
  client: RpcClient | null
  worktreeId: string
  onCancel: () => void
  onLinked: () => void
}

// Link-an-existing-PR form body (number or GitHub URL). Renders a plain View so
// it can sit inline inside the PR sidebar's ScrollView, mirroring the compose
// form fix — a BottomDrawer overlay nested in a ScrollView gets clipped.
export function MobileLinkPrForm({ client, worktreeId, onCancel, onLinked }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileLinkPrFormStyles)
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = parseGitHubPrReference(input)

  const submit = useCallback(async () => {
    if (!client || submitting || parsed === null) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const outcome = await linkMobilePr(client, worktreeId, parsed)
      if (outcome.ok) {
        triggerSuccess()
        onLinked()
      } else {
        triggerError()
        setError(outcome.error)
      }
    } finally {
      setSubmitting(false)
    }
  }, [client, onLinked, parsed, submitting, worktreeId])

  return (
    <View>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>关联现有拉取请求</Text>
        <Pressable
          onPress={onCancel}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="取消"
          hitSlop={8}
        >
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      </View>
      <Text style={styles.label}>PR 编号或 GitHub 链接</Text>
      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="#123 or https://github.com/owner/repo/pull/123"
        placeholderTextColor={theme.color.text.tertiary}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!submitting}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={({ pressed }) => [
          styles.submit,
          (submitting || parsed === null) && styles.submitDisabled,
          pressed && styles.submitPressed
        ]}
        disabled={submitting || parsed === null}
        onPress={() => void submit()}
      >
        {submitting ? (
          <ActivityIndicator size="small" color={theme.color.text.inverse} />
        ) : (
          <Text style={styles.submitText}>{parsed ? `关联 #${parsed}` : '关联拉取请求'}</Text>
        )}
      </Pressable>
    </View>
  )
}

export function createMobileLinkPrFormStyles(theme: MobileTheme) {
  return StyleSheet.create({
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.space8
    },
    heading: {
      color: theme.color.text.primary,
      fontSize: theme.typography.label.fontSize,
      fontWeight: '700'
    },
    cancelText: {
      color: theme.color.text.secondary,
      fontSize: theme.typography.caption.fontSize,
      fontWeight: '600'
    },
    label: {
      color: theme.color.text.secondary,
      fontSize: theme.typography.caption.fontSize,
      marginTop: theme.spacing.space8,
      marginBottom: theme.spacing.space4
    },
    input: {
      backgroundColor: theme.color.bg.subtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      color: theme.color.text.primary,
      fontSize: theme.typography.label.fontSize
    },
    error: {
      color: theme.color.status.danger,
      fontSize: theme.typography.caption.fontSize,
      marginTop: theme.spacing.space12
    },
    submit: {
      marginTop: theme.spacing.space16,
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      alignItems: 'center',
      justifyContent: 'center'
    },
    submitDisabled: { opacity: 0.45 },
    submitPressed: { opacity: 0.8 },
    submitText: {
      color: theme.color.text.inverse,
      fontSize: theme.typography.label.fontSize,
      fontWeight: '600'
    }
  })
}
