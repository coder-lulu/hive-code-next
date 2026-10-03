import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { Check, Copy, FileWarning, Sparkles } from 'lucide-react-native'
import { useClipboardWriter } from '../../platform/clipboard'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'
import type { PRInfo } from '../../../../src/shared/github/pull-request-types'
import { PRSection } from './PRSection'
import { resolveConflictDisplay } from './pr-conflict-presentation'
import { createPrConflictStyles } from './pr-conflict-styles'
import { createPrAiTriageStyles } from './pr-ai-triage-styles'
import { AgentLaunchNotice } from '../AgentLaunchNotice'
import type { MobileAgentLaunchAvailability } from '../../session/mobile-agent-launch-availability'

// Launches the "Resolve conflicts with AI" agent. Absent for display-only usages.
export type PrConflictsTriage = {
  resolveConflicts: () => void
  isBusy: boolean
  availability: MobileAgentLaunchAvailability
  success: string | null
  error: string | null
  warning: string | null
  undeliveredPrompt: string | null
}

type Props = {
  pr: Pick<PRInfo, 'mergeable' | 'conflictSummary'>
  // True while a refresh is in flight, so the fallback notice can explain that
  // missing conflict file details may still be loading (desktop parity).
  isRefreshing?: boolean
  triage?: PrConflictsTriage
}

// Conflicting-files section — shown only when the hosted review reports merge
// conflicts. Lists the conflicting file paths, or a fallback notice when the file
// list is not yet available. Ports the desktop ConflictingFilesSection +
// MergeConflictNotice into the mobile card shell.
export function PRConflictingFilesSection({ pr, isRefreshing = false, triage }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createPrConflictStyles)
  const triageStyles = useMobileThemeStyles(createPrAiTriageStyles)
  const clipboard = useClipboardWriter()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conflict = resolveConflictDisplay(pr)

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current) {
        clearTimeout(copiedResetTimerRef.current)
      }
    }
  }, [])

  if (!conflict) {
    return null
  }
  let noticeBody = '无法获取冲突文件详情'
  if (isRefreshing) {
    noticeBody = '正在刷新冲突详情…'
  } else if (conflict.localMergeClean) {
    noticeBody =
      'GitHub 报告存在冲突，但本地 Git 未能复现。请刷新 PR 或推送分支，以重新计算可合并状态。'
  }

  const copyRefreshCommands = async () => {
    if (!conflict.mergeabilityRefreshCommands) {
      return
    }
    let next: 'copied' | 'failed' = 'copied'
    try {
      await clipboard.writeText(conflict.mergeabilityRefreshCommands)
    } catch {
      next = 'failed'
    }
    if (copiedResetTimerRef.current) {
      clearTimeout(copiedResetTimerRef.current)
    }
    setCopyState(next)
    copiedResetTimerRef.current = setTimeout(() => {
      copiedResetTimerRef.current = null
      setCopyState('idle')
    }, 1500)
  }

  const copyLabel =
    copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制命令'

  return (
    <PRSection title="冲突">
      {conflict.commitsBehind !== null && conflict.baseCommit !== null ? (
        <Text style={styles.meta}>
          落后 {conflict.commitsBehind} 个提交（基准提交：
          <Text style={styles.metaMono}>{conflict.baseCommit}</Text>）
        </Text>
      ) : null}

      {conflict.fileDetailsUnavailable ? (
        <View>
          <Text style={styles.noticeTitle}>此分支存在必须解决的冲突</Text>
          <Text style={styles.noticeBody}>{noticeBody}</Text>
          {conflict.mergeabilityRefreshCommands ? (
            <View style={styles.commandBox}>
              <View style={styles.commandHeader}>
                <Text style={styles.commandLabel}>在此工作树中运行</Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.copyCommandButton,
                    pressed && styles.copyCommandButtonPressed
                  ]}
                  onPress={() => void copyRefreshCommands()}
                  accessibilityRole="button"
                  accessibilityLabel="复制刷新可合并状态的命令"
                >
                  {copyState === 'copied' ? (
                    <Check size={13} color={theme.color.text.primary} strokeWidth={2.2} />
                  ) : (
                    <Copy size={13} color={theme.color.text.primary} strokeWidth={2.2} />
                  )}
                  <Text style={styles.copyCommandText}>{copyLabel}</Text>
                </Pressable>
              </View>
              <Text selectable style={styles.commandText}>
                {conflict.mergeabilityRefreshCommands}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View>
          <View style={styles.filesHeader}>
            <FileWarning size={14} color={theme.color.text.secondary} strokeWidth={2} />
            <Text style={styles.filesHeaderText}>冲突文件</Text>
          </View>
          <ScrollView
            style={styles.fileList}
            contentContainerStyle={styles.fileListContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {conflict.files.map((filePath) => (
              <View key={filePath} style={styles.fileRow}>
                <Text style={styles.filePath}>{filePath}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* "Resolve conflicts with AI" — mirrors desktop's PRTriageStrip. Launches an
          agent that brings the base branch in and completes the merge. */}
      {triage ? (
        <View style={triageStyles.triageArea}>
          <Pressable
            style={({ pressed }) => [
              triageStyles.triageButton,
              pressed && triageStyles.triageButtonPressed
            ]}
            onPress={triage.resolveConflicts}
            disabled={triage.isBusy || triage.availability !== 'available'}
            accessibilityRole="button"
            accessibilityLabel="使用 AI 解决冲突"
          >
            {triage.isBusy ? (
              <ActivityIndicator color={theme.color.text.secondary} />
            ) : (
              <Sparkles size={14} color={theme.color.text.secondary} strokeWidth={2.2} />
            )}
            <Text style={triageStyles.triageButtonText}>使用 AI 解决冲突</Text>
          </Pressable>
          <AgentLaunchNotice
            availability={triage.availability}
            success={triage.success}
            error={triage.error}
            warning={triage.warning}
            undeliveredPrompt={triage.undeliveredPrompt}
            errorStyle={triageStyles.triageError}
          />
        </View>
      ) : null}
    </PRSection>
  )
}
