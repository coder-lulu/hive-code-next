import { StyleSheet, Text, View } from 'react-native'
import type { AccountsSnapshot } from '../components/AccountUsage'
import { MobileHomeQuickActions } from '../components/MobileHomeQuickActions'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import { spacing } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import type { HostProfile } from '../transport/types'
import type { HomeResumeCard } from '../worktree/home-resume-card'
import { MobileHomeAccountUsageCards } from './MobileHomeAccountUsageCards'
import { MobileHomeResumeCard } from './MobileHomeResumeCard'
import { MobileHomeTasksCard } from './MobileHomeTasksCard'

export function MobileHomeListFooter(props: {
  accountsHosts: { host: HostProfile; snapshot: AccountsSnapshot }[]
  connectedHosts: HostProfile[]
  primaryHost: HostProfile | null
  primaryTaskProviders: TaskProvider[]
  resumeCard: HomeResumeCard | null
  onCreateWorkspace: (hostId: string) => void
  onOpenAccounts: (hostId: string) => void
  onOpenResume: (card: HomeResumeCard) => void
  onOpenTasks: (provider?: TaskProvider) => void
  onPairDesktop: () => void
}) {
  const theme = useMobileTheme()
  return (
    <View>
      {props.resumeCard ? (
        <>
          <Text style={[styles.sectionHeading, { color: theme.color.text.secondary }]}>继续工作</Text>
          <MobileHomeResumeCard card={props.resumeCard} onOpen={props.onOpenResume} />
        </>
      ) : null}
      <Text style={[styles.sectionHeading, { color: theme.color.text.secondary }]}>任务中心</Text>
      <MobileHomeTasksCard
        enabled={props.primaryHost != null}
        providers={props.primaryTaskProviders}
        onOpen={props.onOpenTasks}
      />
      <MobileHomeQuickActions
        theme={theme}
        connectedHosts={props.connectedHosts}
        onPairDesktop={props.onPairDesktop}
        onCreateWorkspace={props.onCreateWorkspace}
      />
      <MobileHomeAccountUsageCards items={props.accountsHosts} onOpen={props.onOpenAccounts} />
    </View>
  )
}

const styles = StyleSheet.create({
  sectionHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs
  }
})
