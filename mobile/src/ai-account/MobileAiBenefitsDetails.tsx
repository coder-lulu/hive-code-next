import { StyleSheet, Text, View } from 'react-native'
import { formatAiInteger, type AiBenefits } from '../../../src/shared/hive-ai-account'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { SettingsGroup } from '../settings/SettingsGroup'

export function MobileAiBenefitsDetails({
  benefits,
  loading
}: {
  benefits: AiBenefits | null | undefined
  loading: boolean
}) {
  const theme = useMobileTheme()
  const body = [theme.typography.body, { color: theme.color.text.primary }]
  const meta = [theme.typography.meta, { color: theme.color.text.secondary }]
  const row = {
    padding: theme.spacing.space16,
    gap: theme.spacing.space8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border.subtle
  }
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat('zh-CN', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Shanghai'
        }).format(new Date(value))
      : '—'
  if (loading) {
    return null
  }
  return (
    <View style={{ marginTop: theme.spacing.space24, gap: theme.spacing.space16 }}>
      <SettingsGroup title="用户分组与套餐">
        <View style={row}>
          <Text style={meta}>所在分组</Text>
          <Text selectable style={body}>
            {benefits?.groupFreshness === 'CURRENT' ? benefits.group : '暂不可用'}
          </Text>
        </View>
        {benefits?.subscriptionsFreshness !== 'CURRENT' ? (
          <View style={row}>
            <Text style={body}>套餐信息暂不可用，请稍后刷新。</Text>
          </View>
        ) : !benefits.subscriptions?.length ? (
          <View style={row}>
            <Text style={body}>暂无套餐</Text>
          </View>
        ) : (
          benefits.subscriptions.map((plan) => (
            <View key={plan.id} style={row}>
              <Text
                selectable
                style={[theme.typography.sectionTitle, { color: theme.color.text.primary }]}
              >
                {plan.title || `#${plan.planId}`}
              </Text>
              <Text style={meta}>
                {{ active: '生效中', expired: '已过期', cancelled: '已取消' }[plan.status]}
              </Text>
              {[
                [
                  '套餐总积分',
                  plan.unlimited ? '不限量' : formatAiInteger(plan.totalPoints, 'zh-CN')
                ],
                [
                  '剩余积分',
                  plan.unlimited ? '不限量' : formatAiInteger(plan.remainingPoints, 'zh-CN')
                ],
                ['已用积分', formatAiInteger(plan.usedPoints, 'zh-CN')],
                ['到期时间 · UTC+08:00', date(plan.expiresAt)],
                ['下次重置 · UTC+08:00', date(plan.resetsAt)]
              ].map(([label, value]) => (
                <View key={label} style={{ gap: theme.spacing.space4 }}>
                  <Text style={meta}>{label}</Text>
                  <Text selectable style={body}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>
          ))
        )}
      </SettingsGroup>
      <Text style={meta}>钱包与套餐积分分别核算。1 积分 = 1 New API 额度单位。</Text>
    </View>
  )
}
