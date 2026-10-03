import { StyleSheet, Text, View } from 'react-native'
import { formatAiPrice } from '../../../src/shared/hive-ai-model-candidates'
import { SettingsGroup } from '../settings/SettingsGroup'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { MobileAiReadPage } from './MobileAiReadPage'
import { useMobileAiModelCandidates } from './use-mobile-ai-account'

export default function MobileAiModelsScreen() {
  const state = useMobileAiModelCandidates()
  const theme = useMobileTheme()
  const catalog = state.snapshot?.catalog
  const meta = [theme.typography.meta, { color: theme.color.text.secondary }]
  return (
    <MobileAiReadPage
      {...state}
      title="AI 模型与价格"
      description="查看模型候选与参考价格，无需连接电脑。候选模型待上架，暂不可选择。"
      refreshLabel="刷新 AI 模型价格"
      signedOutMessage="登录后可查看 AI 模型与价格。"
      loadingMessage="正在读取模型价格…"
      errorMessage="模型价格暂不可用，请稍后刷新。"
    >
      {catalog && (
        <View style={{ gap: theme.spacing.space24 }}>
          <Text style={meta}>
            以下为基准分组参考价格，单位为每百万 Token 的 AI 积分，不是货币金额或最终扣费承诺。
          </Text>
          {catalog.models.length === 0 && <Text style={meta}>暂无模型候选。</Text>}
          {catalog.models.map((model) => (
            <SettingsGroup key={model.candidateId} title={model.displayName}>
              <View style={{ padding: theme.spacing.space16, gap: theme.spacing.space8 }}>
                <Text style={[theme.typography.label, { color: theme.color.text.primary }]}>
                  待上架
                </Text>
                <Text style={meta}>
                  {model.protocols
                    .map((p) => (p === 'RESPONSES' ? 'Responses' : 'Chat Completions'))
                    .join(' / ')}
                </Text>
                {model.price.mode !== 'TOKEN_RATIO' && (
                  <Text style={meta}>
                    {model.price.mode === 'TIERED'
                      ? '分层计费，价格说明待完善。'
                      : '暂无可展示的 Token 费率。'}
                  </Text>
                )}
              </View>
              {[
                ['输入', model.price.input],
                ['输出', model.price.output],
                ['缓存读取', model.price.cacheRead],
                ['缓存写入', model.price.cacheWrite]
              ].map(([label, value]) => (
                <View
                  key={label}
                  style={{
                    padding: theme.spacing.space16,
                    gap: theme.spacing.space4,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.color.border.subtle
                  }}
                >
                  <Text style={meta}>{label}</Text>
                  <Text
                    selectable
                    style={[theme.typography.body, { color: theme.color.text.primary }]}
                  >
                    {formatAiPrice(value ?? null, 'zh-CN')}
                  </Text>
                </View>
              ))}
            </SettingsGroup>
          ))}
          <Text style={meta}>
            更新于{' '}
            {new Intl.DateTimeFormat('zh-CN', {
              dateStyle: 'medium',
              timeStyle: 'medium',
              timeZone: 'Asia/Shanghai'
            }).format(new Date(catalog.asOf))}{' '}
            · UTC+08:00
          </Text>
        </View>
      )}
    </MobileAiReadPage>
  )
}
