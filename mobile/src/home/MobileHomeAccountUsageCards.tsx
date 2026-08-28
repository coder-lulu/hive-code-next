import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ClaudeIcon, OpenAIIcon } from '../components/AgentIcons'
import {
  getActiveProviderRateLimits,
  getUsageBarState,
  hasActiveProviderUsage,
  UsageBar,
  type AccountsSnapshot,
  type ProviderKey
} from '../components/AccountUsage'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import type { HostProfile } from '../transport/types'

export function MobileHomeAccountUsageCards(props: {
  items: { host: HostProfile; snapshot: AccountsSnapshot }[]
  onOpen: (hostId: string) => void
}) {
  const theme = useMobileTheme()
  const styles = createStyles(theme)
  if (props.items.length === 0) {
    return null
  }
  return (
    <>
      <Text style={styles.sectionHeading}>Account usage</Text>
      {props.items.map(({ host, snapshot }) => {
        const claudeActive =
          snapshot.claude.accounts.find(
            (account) => account.id === snapshot.claude.activeAccountId
          ) ?? null
        const codexActive =
          snapshot.codex.accounts.find(
            (account) => account.id === snapshot.codex.activeAccountId
          ) ?? null
        return (
          <Pressable
            key={host.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => props.onOpen(host.id)}
          >
            {props.items.length > 1 ? (
              <Text style={styles.hostLabel} numberOfLines={1}>
                {host.name}
              </Text>
            ) : null}
            {(['claude', 'codex'] as ProviderKey[]).map((provider) => {
              const active = provider === 'claude' ? claudeActive : codexActive
              const accounts =
                provider === 'claude' ? snapshot.claude.accounts : snapshot.codex.accounts
              const limits = getActiveProviderRateLimits(snapshot, provider)
              if (accounts.length === 0 && !hasActiveProviderUsage(limits)) {
                return null
              }
              const sessionBar = getUsageBarState(limits, 'session')
              const weeklyBar = getUsageBarState(limits, 'weekly')
              return (
                <View key={provider} style={styles.row}>
                  <View style={styles.icon}>
                    {provider === 'claude' ? (
                      <ClaudeIcon size={18} />
                    ) : (
                      <OpenAIIcon size={18} color={theme.color.text.primary} />
                    )}
                  </View>
                  <View style={styles.info}>
                    <Text style={styles.email} numberOfLines={1}>
                      {active?.email ?? 'System default'}
                    </Text>
                    <View style={styles.bars}>
                      <UsageBar
                        label="5h"
                        usedPercent={sessionBar.usedPercent}
                        unavailable={sessionBar.unavailable}
                        loading={sessionBar.loading}
                      />
                      <UsageBar
                        label="7d"
                        usedPercent={weeklyBar.usedPercent}
                        unavailable={weeklyBar.unavailable}
                        loading={weeklyBar.loading}
                      />
                    </View>
                  </View>
                </View>
              )
            })}
          </Pressable>
        )
      })}
    </>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    sectionHeading: {
      ...theme.typography.meta,
      marginTop: theme.spacing.space24,
      marginBottom: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space4,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    card: {
      gap: theme.spacing.space12,
      marginBottom: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    cardPressed: { backgroundColor: theme.color.bg.subtle },
    hostLabel: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      fontWeight: '500'
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space12 },
    icon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    info: { flex: 1, minWidth: 0, gap: theme.spacing.space4 },
    email: { ...theme.typography.meta, fontWeight: '600', color: theme.color.text.primary },
    bars: { flexDirection: 'row', gap: theme.spacing.space12, marginTop: theme.spacing.space4 }
  })
}
