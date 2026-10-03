import { StyleSheet, Text, View } from 'react-native'
import { formatAiInteger } from '../../../src/shared/hive-ai-account'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { SettingsGroup } from '../settings/SettingsGroup'
import { useMobileAiAccount, useMobileAiBenefits } from './use-mobile-ai-account'
import { MobileAiReadPage } from './MobileAiReadPage'
import { MobileAiBenefitsDetails } from './MobileAiBenefitsDetails'
import { MobileAiConsumptionSection } from './MobileAiConsumptionSection'

const messages = {
  NOT_PROVISIONED: 'AI 账户尚未开通，开通服务暂不可用。',
  PENDING: 'AI 账户正在准备，请稍后刷新。',
  UNKNOWN: 'AI 账户状态待核对，请稍后刷新或联系支持。',
  DISABLED: 'AI 账户已停用，请联系支持。',
  ACTIVE: ''
}

export default function MobileAiAccountScreen() {
  const theme = useMobileTheme()
  const state = useMobileAiAccount()
  const benefitsState = useMobileAiBenefits()
  const balance = state.snapshot?.balance
  const benefits = benefitsState.snapshot?.benefits
  const statuses = [
    balance?.accountStatus,
    benefits?.accountStatus,
    state.snapshot?.account.status,
    benefitsState.snapshot?.account.status
  ]
  const status = statuses.find((value) => value && value !== 'ACTIVE') ?? statuses.find(Boolean)
  const account = state.snapshot?.account ?? benefitsState.snapshot?.account
  const canActivate =
    account?.activationAvailable && ['NOT_PROVISIONED', 'PENDING', 'UNKNOWN'].includes(status ?? '')
  const message =
    status === 'NOT_PROVISIONED' && canActivate
      ? 'AI 账户尚未开通，点击一键开通即可创建并关联。'
      : status
        ? messages[status]
        : ''
  const busy = state.loading || benefitsState.loading || state.activating
  return (
    <MobileAiReadPage
      {...state}
      loading={busy}
      failed={state.failed && benefitsState.failed}
      refresh={async () => {
        await Promise.all([state.refresh(), benefitsState.refresh()])
      }}
      title="AI 积分与用量"
      description="查看当前 Hive 账户的积分、分组、套餐与累计用量，无需连接电脑。"
      refreshLabel="刷新 AI 积分"
      action={
        canActivate
          ? {
              label: status === 'NOT_PROVISIONED' ? '一键开通' : '核实开通结果',
              busy: state.activating,
              disabled: busy,
              onPress: () => void state.activate(benefitsState.refresh)
            }
          : undefined
      }
      signedOutMessage="登录后可查看 AI 积分与用量。"
      loadingMessage="正在读取 AI 账户…"
      errorMessage="AI 积分暂不可用，请稍后刷新。"
      message={message}
    >
      {state.activationFailed && (
        <Text
          accessibilityRole="alert"
          style={[theme.typography.body, { color: theme.color.text.secondary }]}
        >
          未能确认开通请求结果，请刷新核实或联系支持。
        </Text>
      )}
      {!state.loading && !message && balance?.freshness !== 'CURRENT' && (
        <Text style={[theme.typography.body, { color: theme.color.text.secondary }]}>
          钱包积分暂不可用，请稍后刷新。
        </Text>
      )}
      {!message && balance?.freshness === 'CURRENT' && (
        <>
          <SettingsGroup title="账户累计数据">
            {[
              ['可用 AI 积分', balance.availableQuota],
              ['累计消耗积分', balance.usedQuota],
              ['累计调用次数', balance.requestCount]
            ].map(([label, value], index) => (
              <View
                key={label}
                style={{
                  padding: theme.spacing.space16,
                  gap: theme.spacing.space4,
                  borderBottomWidth: index === 2 ? 0 : StyleSheet.hairlineWidth,
                  borderBottomColor: theme.color.border.subtle
                }}
              >
                <Text style={[theme.typography.meta, { color: theme.color.text.secondary }]}>
                  {label}
                </Text>
                <Text
                  selectable
                  style={[theme.typography.sectionTitle, { color: theme.color.text.primary }]}
                >
                  {formatAiInteger(value, 'zh-CN')}
                </Text>
              </View>
            ))}
          </SettingsGroup>
          {balance.availableQuota !== null && BigInt(balance.availableQuota) <= 0n && (
            <Text
              style={[
                theme.typography.body,
                { marginTop: theme.spacing.space16, color: theme.color.status.warningText }
              ]}
            >
              钱包积分余额不足；套餐积分单独核算。
            </Text>
          )}
          <Text
            style={[
              theme.typography.meta,
              { marginTop: theme.spacing.space16, color: theme.color.text.secondary }
            ]}
          >
            更新于{' '}
            {balance.asOf &&
              new Intl.DateTimeFormat('zh-CN', {
                dateStyle: 'medium',
                timeStyle: 'medium',
                timeZone: 'Asia/Shanghai'
              }).format(new Date(balance.asOf))}{' '}
            · UTC+08:00
          </Text>
          <Text
            style={[
              theme.typography.meta,
              { marginTop: theme.spacing.space8, color: theme.color.text.secondary }
            ]}
          >
            1 积分 = 1 New API 额度单位。积分不是货币金额，以上为账户累计数据，不是日期区间统计。
          </Text>
        </>
      )}
      {status === 'ACTIVE' && (
        <MobileAiBenefitsDetails benefits={benefits} loading={benefitsState.loading} />
      )}
      {status === 'ACTIVE' && (
        <MobileAiConsumptionSection
          key={state.snapshot?.accountId ?? benefitsState.snapshot?.accountId}
        />
      )}
    </MobileAiReadPage>
  )
}
