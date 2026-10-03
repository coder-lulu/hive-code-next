import { StyleSheet, Text, View } from 'react-native'
import type { ConsumptionEntry } from '../../../src/shared/hive-ai-consumption'
import { formatAiInteger } from '../../../src/shared/hive-ai-account'
import { useMobileTheme } from '../theme/mobile-theme-provider'

export function MobileAiConsumptionRows({ entries }: { entries: ConsumptionEntry[] }) {
  const theme = useMobileTheme()
  const secondary = [theme.typography.meta, { color: theme.color.text.secondary }]
  if (!entries.length) {
    return (
      <Text style={[...secondary, { padding: theme.spacing.space16 }]}>所选范围暂无消费记录。</Text>
    )
  }
  return entries.map((row) => (
    <View
      key={row.gatewayRequestId}
      style={{
        padding: theme.spacing.space16,
        gap: theme.spacing.space8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.color.border.subtle
      }}
    >
      <Text selectable style={[theme.typography.sectionTitle, { color: theme.color.text.primary }]}>
        {row.modelId}
      </Text>
      <Text style={secondary}>
        {new Intl.DateTimeFormat('zh-CN', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'Asia/Shanghai'
        }).format(new Date(row.recordedAt))}{' '}
        · UTC+08:00
      </Text>
      {[
        ['记录积分', row.recordedPoints],
        ['输入 Token', row.inputTokens],
        ['输出 Token', row.outputTokens]
      ].map(([label, value]) => (
        <View key={label} style={{ gap: theme.spacing.space4 }}>
          <Text style={secondary}>{label}</Text>
          <Text selectable style={[theme.typography.body, { color: theme.color.text.primary }]}>
            {formatAiInteger(value, 'zh-CN')}
          </Text>
        </View>
      ))}
      <Text selectable style={secondary}>
        网关请求编号：{row.gatewayRequestId}
      </Text>
    </View>
  ))
}
