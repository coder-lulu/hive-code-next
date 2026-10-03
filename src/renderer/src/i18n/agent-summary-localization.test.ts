import { afterAll, describe, expect, it } from 'vitest'
import { i18n } from './i18n'
import { makePaneKey } from '../../../shared/stable-pane-id'
import {
  formatSummaryStateLabel,
  summarizeAgents
} from '@/components/sidebar/worktree-card-agent-summary'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { getWorktreeStatusLabel } from '@/lib/worktree-status'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import {
  deriveRunningAgentSendTargets,
  type RunningAgentTargetState
} from '@/lib/running-agent-targets'

const labels = [
  ['en', 'not reporting', 'Needs permission', 'Agent status is stale'],
  ['es', 'sin informes recientes', 'Necesita permiso', 'El estado del agente está desactualizado'],
  [
    'fr',
    'sans mise à jour récente',
    'Autorisation nécessaire',
    'L’état de l’agent n’est plus à jour'
  ],
  ['ja', '最近の報告なし', '権限が必要', 'エージェントの状態情報が古くなっています'],
  ['ko', '최근 보고 없음', '권한 필요', '에이전트 상태 정보가 오래되었습니다'],
  ['zh', '暂无上报', '需要授权', '智能体状态信息已过期']
] as const

describe('localized workspace and agent summary copy', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  it.each(labels)(
    'uses native copy and preserves Git identifiers in %s',
    async (locale, notReporting, permission, stale) => {
      await i18n.changeLanguage(locale)
      expect(formatSummaryStateLabel('unverifiable')).toBe(notReporting)
      expect(getWorktreeStatusLabel('permission')).toBe(permission)
      const agent = { state: 'unverifiable', entry: {} } as DashboardAgentRow
      expect(summarizeAgents([agent], 'Codex')).toContain(notReporting)
      expect(summarizeAgents([agent, agent], 'Codex')).toContain(notReporting)
      const identity = getWorktreeGitIdentityDisplay({ head: 'abcdef123456', branch: '' })!
      expect(identity.kind).toBe('detached')
      if (identity.kind === 'detached') {
        expect(identity.shortHead).toBe('abcdef1')
        expect(identity.sidebarLabel).toContain('HEAD')
        expect(identity.sourceControlLabel).toContain('abcdef1')
        expect(identity.tooltip).toContain('abcdef1')
        if (locale !== 'en') {
          expect(identity.tooltip).not.toContain('You are viewing')
        }
      }
      const paneKey = makePaneKey('tab', '11111111-1111-4111-8111-111111111111')
      const state = {
        agentStatusByPaneKey: {
          [paneKey]: { paneKey, state: 'working', restoredUnconfirmed: true }
        },
        tabsByWorktree: { wt: [{ id: 'tab', title: 'Codex' }] },
        terminalLayoutsByTabId: {},
        ptyIdsByTabId: {}
      } as unknown as RunningAgentTargetState
      expect(deriveRunningAgentSendTargets(state, 'wt')[0]).toMatchObject({
        status: 'disabled',
        disabledReason: stale
      })
    }
  )
})
