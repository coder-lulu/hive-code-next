import { ChevronRight, Terminal } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import type { MobileTheme } from '../theme/mobile-theme'
import type { HomeResumeCard } from '../worktree/home-resume-card'

const REPO_COLORS = ['#8b5cf6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4']

function homeResumeRepoColor(name: string): string {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0
  }
  return REPO_COLORS[Math.abs(hash) % REPO_COLORS.length]
}

export function MobileHomeResumeCard(props: {
  card: HomeResumeCard
  onOpen: (card: HomeResumeCard) => void
}) {
  const theme = useMobileTheme()
  const styles = createStyles(theme)
  return (
    <Pressable
      disabled={!props.card.actionable}
      style={({ pressed }) => [
        styles.resumeCard,
        !props.card.actionable && styles.cardDisabled,
        pressed && styles.cardPressed
      ]}
      onPress={() => props.onOpen(props.card)}
    >
      <View style={styles.resumeIcon}>
        <Terminal size={18} color={theme.color.text.secondary} />
      </View>
      <View style={styles.resumeMain}>
        <Text style={styles.resumeTitle} numberOfLines={1}>
          {props.card.worktree.displayName}
        </Text>
        <View style={styles.resumeSub}>
          <View
            style={[
              styles.repoDot,
              { backgroundColor: homeResumeRepoColor(props.card.worktree.repo) }
            ]}
          />
          <Text style={styles.resumeSubText} numberOfLines={1}>
            {props.card.worktree.repo}
            {'  ·  '}
            {props.card.worktree.branch}
          </Text>
        </View>
      </View>
      <ChevronRight size={16} color={theme.color.text.tertiary} />
    </Pressable>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    resumeCard: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    cardDisabled: { opacity: 0.45 },
    cardPressed: { backgroundColor: theme.color.bg.subtle },
    resumeIcon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: theme.spacing.space12,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    resumeMain: { flex: 1, minWidth: 0 },
    resumeTitle: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    resumeSub: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space4
    },
    repoDot: { width: theme.spacing.space8, height: theme.spacing.space8, borderRadius: theme.radii.circle },
    resumeSubText: { ...theme.typography.caption, flex: 1, color: theme.color.text.secondary }
  })
}
