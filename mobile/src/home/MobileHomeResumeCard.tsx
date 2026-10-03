import { ChevronRight, GitBranch, Monitor } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MobileRepoIcon } from '../components/MobileRepoIcon'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import type { HomeResumeCard } from '../worktree/home-resume-card'
import { homeResumeStatus, type HomeResumeTone } from './home-resume-status'

export function MobileHomeResumeCard(props: {
  readonly card: HomeResumeCard
  readonly onOpen: (card: HomeResumeCard) => void
  readonly runtimeName: string | null
  readonly runtimeOnline: boolean
}) {
  const theme = useMobileTheme()
  const styles = createStyles(theme)
  const status = homeResumeStatus(props.card)
  const statusColor = resumeToneColor(status.tone, theme, false)
  const statusTextColor = resumeToneColor(status.tone, theme, true)
  return (
    <Pressable
      accessibilityLabel={`${props.card.worktree.displayName}，${status.label}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: !props.card.actionable }}
      disabled={!props.card.actionable}
      onPress={() => props.onOpen(props.card)}
      style={({ pressed }) => [
        styles.card,
        !props.card.actionable && styles.cardDisabled,
        pressed && styles.cardPressed
      ]}
    >
      <View style={styles.icon}>
        <MobileRepoIcon color={theme.color.text.primary} size={22} />
      </View>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.title}>
            {props.card.worktree.displayName}
          </Text>
          <View style={styles.status}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={[styles.statusText, { color: statusTextColor }]}
            >
              {status.label}
            </Text>
          </View>
        </View>
        <View style={styles.metaRow}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.metaText}>
            {props.card.worktree.repo}
          </Text>
          <Text style={styles.metaDivider}>·</Text>
          <GitBranch color={theme.color.text.secondary} size={16} strokeWidth={1.9} />
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.metaText}>
            {props.card.worktree.branch}
          </Text>
          <Text style={styles.metaDivider}>·</Text>
          <Monitor color={theme.color.text.secondary} size={16} strokeWidth={1.9} />
          <View
            style={[
              styles.runtimeDot,
              props.runtimeOnline ? styles.runtimeOnline : styles.runtimeUnknown
            ]}
          />
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.runtimeText}>
            {props.runtimeName ?? 'Runtime'} {props.runtimeOnline ? '在线' : '不可验证'}
          </Text>
        </View>
      </View>
      <ChevronRight color={theme.color.text.tertiary} size={18} strokeWidth={1.9} />
    </Pressable>
  )
}

function resumeToneColor(tone: HomeResumeTone, theme: MobileTheme, forText: boolean): string {
  if (tone === 'brand') {
    return theme.color.brand.primary
  }
  if (tone === 'success') {
    return forText ? theme.color.status.successText : theme.color.status.success
  }
  if (tone === 'warning') {
    return forText ? theme.color.status.warningText : theme.color.status.warning
  }
  return theme.color.text.secondary
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    card: {
      minHeight: theme.spacing.space64 + theme.spacing.space16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    cardDisabled: { opacity: 0.68 },
    cardPressed: { backgroundColor: theme.color.bg.subtle },
    icon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    content: { minWidth: 0, flex: 1, gap: theme.spacing.space4 },
    titleRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    title: {
      ...theme.typography.body,
      minWidth: 0,
      flex: 1,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    status: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space4 },
    statusDot: {
      width: theme.spacing.space8,
      height: theme.spacing.space8,
      borderRadius: theme.radii.circle
    },
    statusText: { ...theme.typography.caption, fontWeight: '500' },
    metaRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: theme.spacing.space4
    },
    metaText: {
      ...theme.typography.caption,
      minWidth: 0,
      flexShrink: 1,
      color: theme.color.text.secondary
    },
    metaDivider: { ...theme.typography.caption, color: theme.color.text.tertiary },
    runtimeDot: {
      width: theme.spacing.space8,
      height: theme.spacing.space8,
      borderRadius: theme.radii.circle
    },
    runtimeOnline: { backgroundColor: theme.color.status.success },
    runtimeUnknown: { backgroundColor: theme.color.text.tertiary },
    runtimeText: {
      ...theme.typography.caption,
      minWidth: 0,
      flexShrink: 1,
      color: theme.color.text.secondary
    }
  })
}
