import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { MobileCommitFailureRecovery } from './mobile-commit-failure-recovery'
import type { MobileCommitFailureRecoveryAction } from './use-mobile-commit-failure-recovery'
import { createMobileSourceControlStyles } from './mobile-source-control-styles'

type Props = {
  failure: MobileCommitFailureRecovery
  action: MobileCommitFailureRecoveryAction
}

export function MobileCommitFailurePanel({ failure, action }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileSourceControlStyles)
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDown : ChevronRight
  const detailsText = failure.error.trim()

  return (
    <View style={styles.commitFailurePanel}>
      <View style={styles.commitFailureHeader}>
        <View style={styles.commitFailureTextBlock}>
          <Text style={styles.commitFailureTitle}>提交失败</Text>
          <Text style={styles.commitFailureSummary} numberOfLines={2}>
            {action.summary ?? '提交失败。'}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.commitFailureFixButton,
            action.launching && styles.commitFailureFixButtonDisabled,
            pressed && styles.commitFailureFixButtonPressed
          ]}
          onPress={() => void action.launch()}
          disabled={action.launching}
          accessibilityRole="button"
          accessibilityLabel="使用 AI 修复提交失败"
        >
          {action.launching ? (
            <ActivityIndicator color={theme.color.text.inverse} />
          ) : (
            <Sparkles size={16} color={theme.color.text.inverse} strokeWidth={2} />
          )}
          <Text style={styles.commitFailureFixButtonText}>修复</Text>
        </Pressable>
      </View>
      {action.hasDetails && detailsText ? (
        <>
          <Pressable
            style={({ pressed }) => [
              styles.commitFailureDetailsButton,
              pressed && styles.commitFailureDetailsButtonPressed
            ]}
            onPress={() => setExpanded((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? '隐藏提交失败详情' : '显示提交失败详情'}
          >
            <Chevron size={16} color={theme.color.text.secondary} strokeWidth={2} />
            <Text style={styles.commitFailureDetailsButtonText}>
              {expanded ? '隐藏详情' : '显示详情'}
            </Text>
          </Pressable>
          {expanded ? <Text style={styles.commitFailureDetailsText}>{detailsText}</Text> : null}
        </>
      ) : null}
      {action.launchError ? (
        <Text style={styles.commitFailureLaunchError}>{action.launchError}</Text>
      ) : null}
    </View>
  )
}
