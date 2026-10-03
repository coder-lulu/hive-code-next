import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n, translate } from './i18n'
import {
  formatAutomationDateTime,
  formatAutomationRelativeTime,
  getAutomationRunStatusLabel
} from '@/components/automations/automation-page-parts'
import { formatUpdatedAt } from '@/components/stats/usage-formatters'
import {
  buildUsageShareText,
  formatDateRange,
  RANGE_LABELS
} from '@/components/stats/share-card-utils'
import type { CodexUsageSummary } from '../../../shared/codex-usage-types'

afterEach(async () => {
  vi.useRealTimers()
  await i18n.changeLanguage('en')
})

describe('localized UI helper copy', () => {
  it('translates automation empty states, elapsed times and every run status', async () => {
    await i18n.changeLanguage('zh')
    const now = Date.UTC(2026, 9, 3, 13, 24)
    expect(formatAutomationDateTime(null)).toBe('从未')
    expect(formatAutomationRelativeTime(null, now)).toBeNull()
    expect(formatAutomationRelativeTime(now + 30_000, now)).toBe('现在')
    expect(formatAutomationRelativeTime(now - 8 * 3_600_000, now)).toBe('8小时前')
    expect(formatAutomationRelativeTime(now + 2 * 60_000, now)).toBe('2分钟后')
    expect(formatAutomationRelativeTime(now + 2 * 86_400_000, now)).toBe('2天后')
    const statuses = [
      'pending',
      'dispatching',
      'dispatched',
      'completed',
      'skipped_precheck',
      'skipped_missed',
      'skipped_unavailable',
      'skipped_needs_interactive_auth',
      'dispatch_failed'
    ] as const
    expect(statuses.map((status) => getAutomationRunStatusLabel(status))).toEqual([
      '排队中',
      '启动中',
      '已启动',
      '完成',
      '预检查已跳过',
      '已跳过',
      '不可用',
      '需要凭据',
      '失败'
    ])
  })

  it('refreshes usage scan and share range labels after switching languages', async () => {
    vi.useFakeTimers()
    const now = new Date(2026, 9, 3, 13, 24)
    vi.setSystemTime(now)
    await i18n.changeLanguage('en')
    expect(formatUpdatedAt(null)).toBe('Not scanned yet')
    expect(RANGE_LABELS['7d']).toBe('Last 7 days')

    await i18n.changeLanguage('zh')
    expect(formatUpdatedAt(null)).toBe('尚未扫描')
    expect(formatUpdatedAt(now.getTime())).toBe(`更新于 ${now.toLocaleString('zh')}`)
    expect(RANGE_LABELS['7d']).toBe('近 7 天')
    expect(formatDateRange('all')).toBe(
      `截至 ${now.toLocaleDateString('zh', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })}`
    )

    await i18n.changeLanguage('fr')
    expect(formatUpdatedAt(null)).toBe('Pas encore analysé')
    expect(RANGE_LABELS['7d']).toBe('7 derniers jours')
    expect(getAutomationRunStatusLabel('skipped_needs_interactive_auth')).toBe(
      'Identifiants requis'
    )
    expect(formatAutomationRelativeTime(now.getTime() - 8 * 3_600_000, now.getTime())).toBe(
      'il y a 8 h'
    )
  })

  it('preserves the existing English timing boundaries and status semantics', async () => {
    await i18n.changeLanguage('en')
    const now = Date.UTC(2026, 9, 3, 13, 24)
    expect(formatAutomationRelativeTime(now - 59_000, now)).toBe('now')
    expect(formatAutomationRelativeTime(now - 60_000, now)).toBe('1m ago')
    expect(formatAutomationRelativeTime(now + 3_600_000, now)).toBe('in 1h')
    expect(formatAutomationRelativeTime(now - 86_400_000, now)).toBe('1d ago')
    expect(getAutomationRunStatusLabel('skipped_precheck')).toBe('Precheck skipped')
  })

  it.each(['zh', 'fr', 'ja', 'ko', 'es'])(
    'localizes existing English entries in %s',
    async (locale) => {
      await i18n.changeLanguage(locale)
      expect(
        translate('usage.redesign.collection', 'Collection settings and source details')
      ).not.toBe('Collection settings and source details')
      expect(translate('sparsePreset.addPath', 'Add a folder')).not.toBe('Add a folder')
      expect(
        translate(
          'sparsePreset.pathsUnavailable',
          'Could not read this folder. Type the path instead.'
        )
      ).not.toBe('Could not read this folder. Type the path instead.')
      expect(
        translate(
          'auto.components.terminal.pane.zcode.missing.tui.title',
          'This ZCode build has no terminal UI'
        )
      ).not.toBe('This ZCode build has no terminal UI')
      expect(translate('auto.components.TerminalSearch.10e039b591', 'No results')).not.toBe(
        'No results'
      )
    }
  )

  it('uses the current language when building the share draft and preserves provider totals', async () => {
    const summary: CodexUsageSummary = {
      scope: 'all',
      range: '7d',
      sessions: 3,
      events: 7,
      inputTokens: 100,
      outputTokens: 150,
      cachedInputTokens: 50,
      reasoningOutputTokens: 20,
      totalTokens: 320,
      estimatedCostUsd: 0.125,
      hasUnpricedModels: false,
      topModel: 'test-model',
      topProject: null,
      hasAnyCodexData: true
    }
    const data = { provider: 'codex' as const, summary, daily: [], range: '7d' }
    await i18n.changeLanguage('zh')
    expect(buildUsageShareText(data)).toContain('我的 Codex 用量 · HiveCode（近 7 天）')
    expect(buildUsageShareText(data)).toContain('320 tokens · 预估费用 $0.13')
    await i18n.changeLanguage('fr')
    expect(buildUsageShareText(data)).toContain(
      'Mon utilisation de Codex via HiveCode (7 derniers jours)'
    )
    expect(buildUsageShareText(data)).toContain('320 jetons · coût estimé $0.13')
  })
})
