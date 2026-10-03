import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, describe, expect, it } from 'vitest'
import { i18n } from './i18n'
import { agentNoUpdateLabel, formatCompactDuration } from '@/lib/agent-row-decay-state'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { DashboardAgentChildDisclosure } from '@/components/dashboard/DashboardAgentChildDisclosure'

const labels = {
  en: {
    duration: '34m',
    observation: 'No update in 34m',
    now: 'now',
    show: 'Show 2 child agents',
    hide: 'Hide 1 child agent'
  },
  es: {
    duration: '34min',
    observation: 'Sin actualizaciones desde hace 34min',
    now: 'ahora',
    show: 'Mostrar 2 agentes secundarios',
    hide: 'Ocultar 1 agente secundario'
  },
  fr: {
    duration: '34min',
    observation: 'Aucune mise à jour depuis 34min',
    now: 'maintenant',
    show: 'Afficher 2 sous-agents',
    hide: 'Masquer 1 sous-agent'
  },
  ja: {
    duration: '34分',
    observation: '34分間更新なし',
    now: '今',
    show: '2 件の子エージェントを表示',
    hide: '1 件の子エージェントを非表示'
  },
  ko: {
    duration: '34분',
    observation: '34분 동안 업데이트 없음',
    now: '지금',
    show: '하위 에이전트 2개 표시',
    hide: '하위 에이전트 1개 숨기기'
  },
  zh: {
    duration: '34分钟',
    observation: '34分钟内无更新',
    now: '现在',
    show: '显示 2 个子智能体',
    hide: '隐藏 1 个子智能体'
  }
}

describe('localized agent observations and disclosure labels', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it.each(Object.entries(labels))(
    'updates status, time and accessible copy when switching to %s',
    async (locale, expected) => {
      await i18n.changeLanguage(locale)
      const now = 3_600_000
      const observedAt = now - 34 * 60_000 - 59_000
      expect(formatCompactDuration(now - observedAt)).toBe(expected.duration)
      expect(formatShortTimeAgo(observedAt, now)).toBe(expected.duration)
      expect(formatShortTimeAgo(now, now)).toBe(expected.now)
      expect(agentNoUpdateLabel({ updatedAt: now, evidenceObservedAt: observedAt }, now)).toBe(
        expected.observation
      )
      for (const [count, expanded, label] of [
        [2, false, expected.show],
        [1, true, expected.hide]
      ] as const) {
        const markup = renderToStaticMarkup(
          <DashboardAgentChildDisclosure
            childAgentCount={count}
            childAgentsExpanded={expanded}
            onToggleChildAgents={() => {}}
          />
        )
        expect(markup).toContain(`aria-label="${label}"`)
        expect(markup).toContain(`aria-expanded="${expanded}"`)
      }
    }
  )

  it('keeps duration rounding at minute, hour and day boundaries', async () => {
    await i18n.changeLanguage('en')
    expect(formatCompactDuration(-1)).toBe('0m')
    expect(formatCompactDuration(3_599_999)).toBe('59m')
    expect(formatCompactDuration(3_600_000)).toBe('1h')
    expect(formatCompactDuration(86_399_999)).toBe('23h')
    expect(formatCompactDuration(86_400_000)).toBe('1d')
  })
})
