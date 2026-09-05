import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDot,
  GitPullRequest,
  MessageSquare,
  X
} from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileSourceControlHubStyles } from './mobile-source-control-hub-styles'
import type { MobilePrChipRollup, MobilePrChipSummary } from './mobile-pr-chip-summary'

type Props = {
  summary: MobilePrChipSummary
  onPress: () => void
}

// The glanceable PR status line on the branch card. Tapping it switches to the
// Pull Request segment. Rendered only when the repo supports hosted review — the
// parent gates on that, so this component always has something meaningful to show.
export function MobileSourceControlPrChip({ summary, onPress }: Props) {
  const theme = useMobileTheme()
  const hubStyles = useMobileThemeStyles(createMobileSourceControlHubStyles)
  return (
    <Pressable
      style={({ pressed }) => [hubStyles.chip, pressed && hubStyles.chipPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={chipAccessibilityLabel(summary)}
    >
      <View style={hubStyles.chipIcon}>
        <GitPullRequest size={16} color={theme.color.text.secondary} strokeWidth={2} />
      </View>
      {summary.kind === 'loading' ? (
        <>
          <ActivityIndicator size="small" color={theme.color.text.secondary} />
          <Text style={hubStyles.chipMutedText} numberOfLines={1}>
            正在加载拉取请求…
          </Text>
        </>
      ) : summary.kind === 'none' ? (
        <>
          <Text style={hubStyles.chipCreateText}>创建拉取请求</Text>
          <View style={hubStyles.chipSpacer} />
          <ChevronRight size={16} color={theme.color.text.tertiary} strokeWidth={2} />
        </>
      ) : summary.kind === 'unavailable' ? (
        <>
          <Text style={hubStyles.chipMutedText} numberOfLines={1}>
            {summary.message}
          </Text>
          <ChevronRight size={16} color={theme.color.text.tertiary} strokeWidth={2} />
        </>
      ) : (
        <>
          <Text style={hubStyles.chipNumber}>#{summary.number}</Text>
          <View
            style={[
              hubStyles.statePill,
              { borderColor: mobilePrStatusColor(theme, summary.stateToken) }
            ]}
          >
            <Text
              style={[
                hubStyles.statePillText,
                { color: mobilePrStatusTextColor(theme, summary.stateToken) }
              ]}
            >
              {localizePrStateLabel(summary.stateLabel)}
            </Text>
          </View>
          <ChipRollup rollup={summary.rollup} />
          {summary.commentCount != null && summary.commentCount > 0 ? (
            <View style={hubStyles.comment}>
              <MessageSquare size={16} color={theme.color.text.secondary} strokeWidth={2} />
              <Text style={hubStyles.commentText}>{summary.commentCount}</Text>
            </View>
          ) : null}
          <View style={hubStyles.chipSpacer} />
          <ChevronRight size={16} color={theme.color.text.tertiary} strokeWidth={2} />
        </>
      )}
    </Pressable>
  )
}

function ChipRollup({ rollup }: { rollup: MobilePrChipRollup }) {
  const theme = useMobileTheme()
  const hubStyles = useMobileThemeStyles(createMobileSourceControlHubStyles)
  const color = mobilePrStatusColor(theme, rollup.token)
  const textColor = mobilePrStatusTextColor(theme, rollup.token)
  return (
    <View style={hubStyles.rollup}>
      <RollupIcon kind={rollup.kind} color={color} />
      <Text style={[hubStyles.rollupText, { color: textColor }]}>
        {localizeRollupText(rollup.text)}
      </Text>
    </View>
  )
}

function RollupIcon({ kind, color }: { kind: MobilePrChipRollup['kind']; color: string }) {
  const size = 13
  const strokeWidth = 2.3
  switch (kind) {
    case 'conflict':
      return <AlertTriangle size={size} color={color} strokeWidth={strokeWidth} />
    case 'failing':
      return <X size={size} color={color} strokeWidth={strokeWidth} />
    case 'running':
      return <CircleDot size={size} color={color} strokeWidth={strokeWidth} />
    case 'passed':
      return <Check size={size} color={color} strokeWidth={strokeWidth} />
    case 'none':
      return null
  }
}

function chipAccessibilityLabel(summary: MobilePrChipSummary): string {
  switch (summary.kind) {
    case 'loading':
      return '正在加载拉取请求'
    case 'none':
      return '创建拉取请求'
    case 'unavailable':
      return `拉取请求不可用：${summary.message}`
    case 'ready': {
      const comments =
        summary.commentCount != null && summary.commentCount > 0
          ? `，${summary.commentCount} 条未解决评论`
          : ''
      return `拉取请求 #${summary.number}，${localizePrStateLabel(summary.stateLabel)}，${localizeRollupText(summary.rollup.text)}${comments}。打开拉取请求。`
    }
  }
}

function mobilePrStatusColor(theme: MobileTheme, token: MobilePrChipRollup['token']): string {
  switch (token) {
    case 'statusGreen':
      return theme.color.status.success
    case 'statusAmber':
      return theme.color.status.warning
    case 'statusRed':
      return theme.color.status.danger
    case 'statusPurple':
      return theme.color.brand.primary
    default:
      return theme.color.text.secondary
  }
}

function mobilePrStatusTextColor(theme: MobileTheme, token: MobilePrChipRollup['token']): string {
  switch (token) {
    case 'statusGreen':
      return theme.color.status.successText
    case 'statusAmber':
      return theme.color.status.warningText
    case 'statusRed':
      return theme.color.status.dangerText
    case 'statusPurple':
      return theme.color.brand.primary
    default:
      return theme.color.text.secondary
  }
}

function localizePrStateLabel(label: string): string {
  const labels: Readonly<Record<string, string>> = {
    Open: '开放',
    Draft: '草稿',
    Closed: '已关闭',
    Merged: '已合并'
  }
  return labels[label] ?? label
}

function localizeRollupText(text: string): string {
  if (text === 'Conflicts') {
    return '存在冲突'
  }
  if (text === 'No checks') {
    return '无检查项'
  }
  if (text === 'Unresolved checks') {
    return '检查未完成'
  }
  return text.replace(/^(\d+) failing$/, '$1 项失败').replace(/^(\d+) running$/, '$1 项进行中')
}
