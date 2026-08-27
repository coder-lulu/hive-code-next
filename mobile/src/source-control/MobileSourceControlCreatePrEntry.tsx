import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { GitPullRequestArrow } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { MobileCreatePrAction } from './mobile-create-pr-action'
import { localizeMobileSourceControlCopy } from './mobile-source-control-screen-state'
import { createMobileSourceControlStyles } from './mobile-source-control-styles'

type Props = {
  action: MobileCreatePrAction
}

export function MobileSourceControlCreatePrEntry({ action }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileSourceControlStyles)
  if (!action.visible) {
    return null
  }
  const enabled = !action.disabled
  const label = localizeMobileSourceControlCopy(action.label)
  const copy = action.hint ? localizeCreateReviewHint(action.hint) : label
  return (
    <View style={styles.createPrBlock}>
      <Pressable
        style={({ pressed }) => [
          styles.createPrButton,
          !enabled && styles.createPrButtonDisabled,
          pressed && enabled && styles.createPrButtonPressed
        ]}
        disabled={action.disabled}
        onPress={action.onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={action.hint ? localizeCreateReviewHint(action.hint) : undefined}
      >
        {action.loading ? (
          <ActivityIndicator
            size="small"
            color={enabled ? theme.color.text.inverse : theme.color.text.secondary}
          />
        ) : (
          <GitPullRequestArrow
            size={16}
            color={enabled ? theme.color.text.inverse : theme.color.text.secondary}
            strokeWidth={2}
          />
        )}
        <Text
          style={[
            styles.createPrButtonText,
            !enabled && styles.createPrButtonTextDisabled,
            action.hint && styles.createPrButtonHint
          ]}
          numberOfLines={2}
        >
          {copy}
        </Text>
      </Pressable>
    </View>
  )
}

function localizeCreateReviewHint(hint: string): string {
  const reviewLabel = hint.includes('merge request') ? '合并请求' : '拉取请求'
  if (hint.startsWith('Commit changes before creating')) {
    return `请先提交更改再创建${reviewLabel}。`
  }
  if (hint.startsWith('Check out a branch before creating')) {
    return `请先检出分支再创建${reviewLabel}。`
  }
  if (hint.startsWith('Switch to a feature branch before creating')) {
    return `请先切换到功能分支再创建${reviewLabel}。`
  }
  if (hint.startsWith('Publish commits before creating')) {
    return `请先发布提交再创建${reviewLabel}。`
  }
  if (hint.startsWith('Sync this branch before creating')) {
    return `请先同步此分支再创建${reviewLabel}。`
  }
  if (hint.startsWith('Authenticate before creating')) {
    return `请先完成身份验证再创建${reviewLabel}。`
  }
  if (hint.startsWith('Creating') && hint.includes('is not supported for this repo')) {
    return `此仓库不支持创建${reviewLabel}。`
  }
  if (hint.includes('already exists for this branch')) {
    return `此分支已有${reviewLabel}。`
  }
  if (hint.includes('from this fork is not supported')) {
    return `暂不支持从此派生仓库创建${reviewLabel}。`
  }
  if (hint.startsWith('Push the base branch before creating')) {
    return `请先推送基础分支再创建${reviewLabel}。`
  }
  if (hint.startsWith('This branch is not ready for')) {
    return `此分支尚未满足创建${reviewLabel}的条件。`
  }
  return hint
}
