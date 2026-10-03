import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { openExternalLink } from '../../platform/external-link'
import { ChevronDown, ChevronRight, ExternalLink, RotateCw, Sparkles } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'
import type { PRCheckDetail } from '../../../../src/shared/github/check-types'
import type { RpcClient } from '../../transport/rpc-client'
import { fetchPRCheckDetails, type GitHubPrRepoSlug } from '../../session/github-pr-rpc'
import type { MobilePrActions } from '../../session/use-mobile-pr-actions'
import {
  checkOutcome,
  checkOutcomeToken,
  checkStatusLabel,
  firstFailingCheckKey,
  prCheckKey,
  prChecksSummaryLabel,
  sortPRChecks,
  summarizePRChecks
} from './pr-checks-presentation'
import { statusColor, statusTextColor } from './pr-sidebar-status-color'
import { PRSection } from './PRSection'
import { PRCheckDetailView, type DetailEntry } from './PRCheckDetail'
import { createMobilePrSidebarStyles } from './mobile-pr-sidebar-styles'
import { createPrAiTriageStyles } from './pr-ai-triage-styles'
import { AgentLaunchNotice } from '../AgentLaunchNotice'
import type { MobileAgentLaunchAvailability } from '../../session/mobile-agent-launch-availability'

// Launches the "Fix checks with AI" agent. Absent for display-only usages.
export type PrChecksTriage = {
  fixChecks: () => void
  isBusy: boolean
  availability: MobileAgentLaunchAvailability
  success: string | null
  error: string | null
  warning: string | null
  undeliveredPrompt: string | null
}

type Props = {
  checks: PRCheckDetail[]
  // Set when the checks read failed; the section shows it in place of the rows.
  checksError: string | null
  client: RpcClient | null
  worktreeId: string
  prRepo?: GitHubPrRepoSlug | null
  // Optional so display-only usages (e.g. tests/storybook) can omit mutations.
  actions?: MobilePrActions
  triage?: PrChecksTriage
}

// Checks summary (counts) + sorted per-check rows. Each row expands to lazily
// fetch github.prCheckDetails, cached per check key (U5). Display-only; the
// rerun action is U6.
export function PRChecksSection({
  checks,
  checksError,
  client,
  worktreeId,
  prRepo,
  actions,
  triage
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobilePrSidebarStyles)
  const triageStyles = useMobileThemeStyles(createPrAiTriageStyles)
  const sorted = sortPRChecks(checks)
  const summary = summarizePRChecks(checks)
  const rerunBusy = actions?.isBusy({ kind: 'rerun' }) ?? false
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [detailCache, setDetailCache] = useState<Record<string, DetailEntry>>({})

  const loadDetail = useCallback(
    async (check: PRCheckDetail, key: string) => {
      if (!client) {
        return
      }
      let entry: DetailEntry
      try {
        const outcome = await fetchPRCheckDetails(client, worktreeId, {
          checkRunId: check.checkRunId,
          workflowRunId: check.workflowRunId,
          checkName: check.name,
          url: check.url,
          prRepo
        })
        entry = outcome.ok
          ? { status: 'loaded', details: outcome.result }
          : { status: 'error', message: outcome.error }
      } catch (err) {
        // Why: a rejection must clear the entry's `loading` state, not leave it
        // spinning forever — fall back to an error detail.
        entry = {
          status: 'error',
          message: err instanceof Error ? err.message : '无法加载检查详情'
        }
      }
      setDetailCache((prev) => ({ ...prev, [key]: entry }))
    },
    [client, worktreeId, prRepo]
  )

  // Fetch a check's detail the first time it expands; the loaded entry is the cache.
  const ensureDetail = useCallback(
    (check: PRCheckDetail, key: string) => {
      setDetailCache((prev) => {
        if (prev[key] || !client) {
          return prev
        }
        void loadDetail(check, key)
        return { ...prev, [key]: { status: 'loading' } }
      })
    },
    [client, loadDetail]
  )

  const toggle = useCallback(
    (check: PRCheckDetail) => {
      const key = prCheckKey(check)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(key)) {
          next.delete(key)
          return next
        }
        next.add(key)
        return next
      })
      ensureDetail(check, key)
    },
    [ensureDetail]
  )

  // Auto-expand the first failing check once per loaded check set (parity with the
  // desktop ChecksList). Keyed on the sorted check identities so a worktree switch
  // or fresh load re-runs it, but the user's later manual collapses are not fought.
  const autoExpandedSignatureRef = useRef<string | null>(null)
  const sortedSignature = sorted.map(prCheckKey).join('|')
  useEffect(() => {
    if (autoExpandedSignatureRef.current === sortedSignature) {
      return
    }
    autoExpandedSignatureRef.current = sortedSignature
    const key = firstFailingCheckKey(sorted)
    if (!key) {
      return
    }
    const failing = sorted.find((check) => prCheckKey(check) === key)
    if (!failing) {
      return
    }
    setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
    ensureDetail(failing, key)
  }, [ensureDetail, sorted, sortedSignature])

  return (
    <PRSection
      title="检查"
      trailing={
        <>
          <Text
            style={[
              styles.summaryLabel,
              { color: statusTextColor(checkOutcomeToken(summary.outcome), theme) }
            ]}
          >
            {prChecksSummaryLabel(summary, checksError)}
          </Text>
          {/* Rerun is offered only when something failed; spinner-in-place while in-flight. */}
          {actions && summary.failed > 0 ? (
            <Pressable
              style={styles.iconButton}
              onPress={() => actions.rerunFailingChecks()}
              disabled={rerunBusy}
              accessibilityRole="button"
              accessibilityLabel="重新运行失败的检查"
            >
              {rerunBusy ? (
                <ActivityIndicator color={theme.color.text.secondary} />
              ) : (
                <RotateCw size={14} color={theme.color.text.secondary} strokeWidth={2.2} />
              )}
            </Pressable>
          ) : null}
        </>
      }
    >
      {/* Triage strip at the top of the section (desktop PRTriageStrip): a failing
          summary + a Fix action, so the most actionable state leads the list. */}
      {triage && summary.failed > 0 ? (
        <View style={triageStyles.triageStrip}>
          <View style={triageStyles.triageStripText}>
            <Text style={triageStyles.triageStripTitle} numberOfLines={1}>
              {summary.failed} 项检查失败
            </Text>
            <Text style={triageStyles.triageStripSubtitle} numberOfLines={1}>
              查看详情，或让 AI 开始修复。
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [triageStyles.triageStripButton, pressed && { opacity: 0.7 }]}
            onPress={triage.fixChecks}
            disabled={triage.isBusy || triage.availability !== 'available'}
            accessibilityRole="button"
            accessibilityLabel="使用 AI 修复失败的检查"
          >
            {triage.isBusy ? (
              <ActivityIndicator color={theme.color.text.secondary} />
            ) : (
              <Sparkles size={13} color={theme.color.text.secondary} strokeWidth={2.2} />
            )}
            <Text style={triageStyles.triageStripButtonText}>修复</Text>
          </Pressable>
        </View>
      ) : null}
      {triage ? (
        <AgentLaunchNotice
          availability={summary.failed > 0 ? triage.availability : 'available'}
          success={triage.success}
          error={triage.error}
          warning={triage.warning}
          undeliveredPrompt={triage.undeliveredPrompt}
          errorStyle={triageStyles.triageError}
        />
      ) : null}
      {checksError ? <Text style={triageStyles.triageError}>{checksError}</Text> : null}
      {sorted.map((check) => {
        const key = prCheckKey(check)
        const isOpen = expanded.has(key)
        const token = checkOutcomeToken(checkOutcome(check))
        const Chevron = isOpen ? ChevronDown : ChevronRight
        const url = check.url
        return (
          <View key={key}>
            <Pressable
              style={styles.row}
              onPress={() => toggle(check)}
              accessibilityRole="button"
              accessibilityLabel={`${check.name} 检查详情`}
            >
              <Chevron size={14} color={theme.color.text.secondary} strokeWidth={2.2} />
              <View style={[styles.statusDot, { backgroundColor: statusColor(token, theme) }]} />
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {check.name}
                </Text>
              </View>
              {/* Status word + open-on-host icon (desktop ChecksList row), so the
                  outcome reads without expanding. */}
              <Text
                style={[styles.rowStatus, { color: statusTextColor(token, theme) }]}
                numberOfLines={1}
              >
                {checkStatusLabel(check)}
              </Text>
              {url ? (
                <Pressable
                  style={styles.rowTrailing}
                  onPress={() => openExternalLink(url)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`在网页中打开 ${check.name}`}
                >
                  <ExternalLink size={13} color={theme.color.text.secondary} strokeWidth={2.2} />
                </Pressable>
              ) : null}
            </Pressable>
            {isOpen ? <PRCheckDetailView entry={detailCache[key]} /> : null}
          </View>
        )
      })}
    </PRSection>
  )
}
