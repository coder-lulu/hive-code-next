import { StyleSheet, Text, View } from 'react-native'
import type { AccountsSnapshot } from '../components/AccountUsage'
import { MobileHomeQuickActions } from '../components/MobileHomeQuickActions'
import type { TaskProvider } from '../tasks/mobile-task-providers'
import type { MobileTheme } from '../theme/mobile-theme'
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
  const styles = createStyles(theme)
  const resumeRuntime = props.resumeCard
    ? props.connectedHosts.find((host) => host.id === props.resumeCard?.hostId)
    : null
  return (
    <View>
      {props.resumeCard ? (
        <>
          <Text maxFontSizeMultiplier={1.3} style={styles.sectionHeading}>
            继续工作
          </Text>
          <MobileHomeResumeCard
            card={props.resumeCard}
            onOpen={props.onOpenResume}
            runtimeName={resumeRuntime?.name ?? null}
            runtimeOnline={resumeRuntime != null}
          />
        </>
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={styles.sectionHeading}>
        任务中心
      </Text>
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

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    sectionHeading: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space16,
      marginBottom: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space4,
      color: theme.color.text.secondary,
      fontWeight: '600'
    }
  })
}
