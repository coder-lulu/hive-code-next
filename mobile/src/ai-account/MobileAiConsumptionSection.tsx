import { useCallback, useEffect, useState } from 'react'
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  consumptionRange,
  consumptionPreset,
  type ConsumptionQuery
} from '../../../src/shared/hive-ai-consumption'
import type { MobileSession } from '../auth/mobile-sms-session'
import { PairingActionButton } from '../components/pairing/PairingActionButton'
import { SettingsGroup } from '../settings/SettingsGroup'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { readMobileAiConsumption } from './mobile-ai-consumption-client'
import { useMobileAiCloudRead } from './use-mobile-ai-cloud-read'
import { MobileAiConsumptionRows } from './MobileAiConsumptionRows'

export function MobileAiConsumptionSection() {
  const theme = useMobileTheme()
  const [initialDates] = useState(() => consumptionPreset(7))
  const [from, setFrom] = useState(initialDates[0])
  const [to, setTo] = useState(initialDates[1])
  const [model, setModel] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const [showLoading, setShowLoading] = useState(false)
  const [query, setQuery] = useState<ConsumptionQuery>(() => ({
    ...consumptionRange(initialDates),
    page: 1,
    size: 20
  }))
  const read = useCallback(
    (session: MobileSession, signal: AbortSignal) =>
      readMobileAiConsumption(session, query, signal),
    [query]
  )
  const state = useMobileAiCloudRead(read)
  const result = state.snapshot?.history
  const current =
    !invalid &&
    result?.from === query.from &&
    result.to === query.to &&
    result.page === query.page &&
    result.model === query.model
      ? result
      : null
  useEffect(() => {
    setShowLoading(false)
    if (!state.loading) {
      return
    }
    const timer = setTimeout(() => setShowLoading(true), 300)
    return () => clearTimeout(timer)
  }, [state.loading])
  function search() {
    submit([from, to])
  }
  function submit(dates: [string, string]) {
    try {
      const range = consumptionRange(dates, model.trim())
      setInvalid(false)
      Keyboard.dismiss()
      setQuery({ ...range, page: 1, size: 20 })
    } catch {
      setInvalid(true)
    }
  }
  function preset(days: 1 | 7 | 30) {
    const dates = consumptionPreset(days)
    setFrom(dates[0])
    setTo(dates[1])
    submit(dates)
  }
  const field = (label: string, value: string, update: (value: string) => void, date = false) => (
    <View style={{ gap: theme.spacing.space4 }}>
      <Text style={[theme.typography.label, { color: theme.color.text.primary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={update}
        maxLength={date ? 10 : 128}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={date ? 'YYYY-MM-DD' : '全部模型'}
        placeholderTextColor={theme.color.text.tertiary}
        returnKeyType="search"
        onSubmitEditing={search}
        onFocus={() => setFocused(label)}
        onBlur={() => setFocused(null)}
        style={[
          theme.typography.body,
          {
            minHeight: theme.spacing.space48,
            color: theme.color.text.primary,
            backgroundColor: theme.color.bg.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: focused === label ? theme.color.brand.primary : theme.color.border.default,
            borderRadius: theme.radii.control,
            paddingHorizontal: theme.spacing.space12,
            paddingVertical: theme.spacing.space8
          }
        ]}
      />
    </View>
  )
  const message = invalid
    ? '请选择不超过 31 天的日期范围（YYYY-MM-DD），并检查模型名称。'
    : state.failed
      ? '消费记录暂不可用，请稍后重试。'
      : showLoading
        ? '正在读取消费记录…'
        : null
  return (
    <View style={{ marginTop: theme.spacing.space24, gap: theme.spacing.space16 }}>
      <SettingsGroup title="消费记录">
        <View style={{ padding: theme.spacing.space16, gap: theme.spacing.space12 }}>
          <Text style={[theme.typography.meta, { color: theme.color.text.secondary }]}>
            UTC+08:00，最多查询 31
            天。以下为实时网关日志，记录积分不代表已确认结算；翻页期间可能出现新记录。
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.space8 }}>
            {([1, 7, 30] as const).map((days) => (
              <PairingActionButton
                key={days}
                label={days === 1 ? '今日' : `近 ${days} 天`}
                variant="secondary"
                style={{ width: 'auto', paddingHorizontal: theme.spacing.space12 }}
                disabled={state.loading || !state.signedIn}
                onPress={() => preset(days)}
              />
            ))}
          </View>
          {field('开始日期', from, setFrom, true)}
          {field('结束日期', to, setTo, true)}
          {field('模型（精确名称）', model, setModel)}
          {invalid && (
            <Text
              accessibilityRole="alert"
              style={[theme.typography.meta, { color: theme.color.status.warningText }]}
            >
              {message}
            </Text>
          )}
          <PairingActionButton
            label="查询记录"
            loading={showLoading}
            disabled={state.loading || !state.signedIn}
            onPress={search}
          />
          {!invalid && message && (
            <Text
              accessibilityLiveRegion="polite"
              style={[theme.typography.body, { color: theme.color.text.secondary }]}
            >
              {message}
            </Text>
          )}
        </View>
        {current && !state.loading && <MobileAiConsumptionRows entries={current.entries} />}
      </SettingsGroup>
      {current && !state.loading && (
        <View style={{ gap: theme.spacing.space8 }}>
          <Text style={[theme.typography.meta, { color: theme.color.text.secondary }]}>
            第 {current.page} 页
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.space8 }}>
            <PairingActionButton
              label="上一页"
              variant="secondary"
              style={{ flex: 1, width: 'auto' }}
              disabled={current.page <= 1}
              onPress={() => setQuery({ ...query, page: query.page - 1 })}
            />
            <PairingActionButton
              label="下一页"
              variant="secondary"
              style={{ flex: 1, width: 'auto' }}
              disabled={
                current.page >= 1000 ||
                BigInt(current.reportedTotal) <= BigInt(current.page * current.size)
              }
              onPress={() => setQuery({ ...query, page: query.page + 1 })}
            />
          </View>
        </View>
      )}
    </View>
  )
}
