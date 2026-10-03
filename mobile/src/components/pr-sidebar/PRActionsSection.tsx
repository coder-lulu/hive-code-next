import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { GitMerge, Link2Off } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'
import type { GitHubPRMergeMethod, PRInfo } from '../../../../src/shared/github/pull-request-types'
import type { RpcClient } from '../../transport/rpc-client'
import type { MobilePrActions } from '../../session/use-mobile-pr-actions'
import { unlinkMobilePr } from '../../source-control/mobile-pr-link'
import { ConfirmModal } from '../ConfirmModal'
import { canShowMobilePRAutoMergeControl } from './pr-auto-merge-availability'
import { resolveMobilePrMergeMethod, resolvePrActionAvailability } from './pr-actions-state'
import { createPrActionsStyles } from './pr-actions-styles'

type Props = {
  pr: PRInfo
  actions: MobilePrActions
  client: RpcClient | null
  worktreeId: string
  // Refetch after unlinking so the view returns to the create/link empty state.
  onUnlinked: () => void
}

type Confirm =
  | { kind: 'merge'; method: GitHubPRMergeMethod }
  | { kind: 'state'; state: 'open' | 'closed' }

// Merge primary; Close/Reopen + Unlink share one secondary row. No section title —
// button labels are self-explanatory and a header wasted a full row on mobile.
export function PRActionsSection({ pr, actions, client, worktreeId, onUnlinked }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createPrActionsStyles)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [unlinking, setUnlinking] = useState(false)
  // Local unlink errors — unlink is not routed through the actions engine.
  const [unlinkError, setUnlinkError] = useState<string | null>(null)

  // Mobile keeps merge one-tap: use the repo default instead of surfacing a
  // desktop-style method picker in the narrow PR action stack.
  const effectiveMethod = resolveMobilePrMergeMethod(pr.mergeMethodSettings)
  const state = actions.resolveState(pr.state)
  const autoMerge = actions.resolveAutoMerge(pr.autoMergeEnabled ?? false)
  const avail = resolvePrActionAvailability(state)
  const mergeBusy = actions.isBusy({ kind: 'merge' })
  const autoMergeBusy = actions.isBusy({ kind: 'autoMerge' })
  const stateBusy = actions.isBusy({ kind: 'state' })
  const unlinkBusy = unlinking || mergeBusy || autoMergeBusy || stateBusy
  const showAutoMerge =
    avail.canAutoMerge &&
    canShowMobilePRAutoMergeControl({
      ...pr,
      autoMergeEnabled: autoMerge || pr.autoMergeEnabled === true
    })
  const showSecondary = avail.canClose || avail.canReopen || avail.canUnlink
  const actionError = unlinkError ?? actions.error

  const unlink = useCallback(async (): Promise<void> => {
    if (!client || unlinking) {
      return
    }
    setUnlinking(true)
    setUnlinkError(null)
    try {
      const outcome = await unlinkMobilePr(client, worktreeId)
      if (outcome.ok) {
        onUnlinked()
      } else {
        setUnlinkError(outcome.error)
      }
    } catch (err) {
      setUnlinkError(err instanceof Error ? err.message : '取消关联拉取请求失败。')
    } finally {
      setUnlinking(false)
    }
  }, [client, onUnlinked, unlinking, worktreeId])

  const confirmCopy = (): { title: string; message: string; confirmLabel: string } => {
    if (confirm?.kind === 'merge') {
      return {
        title: '合并拉取请求？',
        message: `这会将 #${pr.number} 合并到目标分支。`,
        confirmLabel: '合并'
      }
    }
    if (confirm?.kind === 'state' && confirm.state === 'closed') {
      return {
        title: '关闭拉取请求？',
        message: `#${pr.number} 将被关闭且不会合并。`,
        confirmLabel: '关闭'
      }
    }
    return {
      title: '重新打开拉取请求？',
      message: `#${pr.number} 将重新打开。`,
      confirmLabel: '重新打开'
    }
  }

  const runConfirmed = (): void => {
    if (!confirm) {
      return
    }
    // Engine errors take over the shared error line after this; drop unlink text.
    setUnlinkError(null)
    if (confirm.kind === 'merge') {
      actions.merge(confirm.method)
    } else {
      actions.updateState(confirm.state)
    }
  }

  const copy = confirmCopy()

  return (
    <View style={styles.actionsBlock}>
      {avail.canMerge ? (
        <Pressable
          style={[
            styles.actionButton,
            styles.actionButtonMerge,
            mergeBusy && styles.actionButtonDisabled
          ]}
          onPress={() => {
            setUnlinkError(null)
            setConfirm({ kind: 'merge', method: effectiveMethod })
          }}
          disabled={mergeBusy}
          accessibilityRole="button"
          accessibilityLabel="合并拉取请求"
        >
          {mergeBusy ? (
            <ActivityIndicator color={theme.color.text.inverse} />
          ) : (
            <GitMerge size={16} color={theme.color.text.inverse} strokeWidth={2.2} />
          )}
          <Text style={[styles.actionButtonText, styles.actionButtonTextMerge]}>合并拉取请求</Text>
        </Pressable>
      ) : null}

      {showAutoMerge ? (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>就绪后自动合并</Text>
          <Pressable
            style={[styles.togglePill, autoMerge && styles.togglePillOn]}
            onPress={() => {
              setUnlinkError(null)
              actions.setAutoMerge(!autoMerge, effectiveMethod)
            }}
            disabled={autoMergeBusy}
            accessibilityRole="switch"
            accessibilityState={{ checked: autoMerge }}
            accessibilityLabel="切换自动合并"
          >
            {autoMergeBusy ? (
              <ActivityIndicator color={theme.color.text.secondary} />
            ) : (
              <Text style={[styles.togglePillText, autoMerge && styles.togglePillTextOn]}>
                {autoMerge ? '开启' : '关闭'}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {showSecondary ? (
        <View style={styles.secondaryRow}>
          {avail.canClose || avail.canReopen ? (
            <Pressable
              style={[
                styles.actionButton,
                styles.secondaryButton,
                stateBusy && styles.actionButtonDisabled
              ]}
              onPress={() => {
                setUnlinkError(null)
                setConfirm({ kind: 'state', state: avail.canClose ? 'closed' : 'open' })
              }}
              disabled={stateBusy}
              accessibilityRole="button"
              accessibilityLabel={avail.canClose ? '关闭拉取请求' : '重新打开拉取请求'}
            >
              {stateBusy ? <ActivityIndicator color={theme.color.text.secondary} /> : null}
              <Text
                style={[
                  styles.actionButtonText,
                  avail.canClose && styles.actionButtonDestructiveText
                ]}
              >
                {avail.canClose ? '关闭' : '重新打开'}
              </Text>
            </Pressable>
          ) : null}
          {avail.canUnlink ? (
            <Pressable
              style={[
                styles.actionButton,
                styles.secondaryButton,
                unlinkBusy && styles.actionButtonDisabled
              ]}
              onPress={() => void unlink()}
              disabled={unlinkBusy}
              accessibilityRole="button"
              accessibilityLabel="取消关联拉取请求"
            >
              {unlinking ? (
                <ActivityIndicator color={theme.color.text.secondary} />
              ) : (
                <Link2Off size={16} color={theme.color.text.secondary} strokeWidth={2.2} />
              )}
              <Text style={styles.actionButtonText}>取消关联</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

      <ConfirmModal
        visible={confirm !== null}
        title={copy.title}
        message={copy.message}
        confirmLabel={copy.confirmLabel}
        destructive={confirm?.kind === 'state' && confirm.state === 'closed'}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </View>
  )
}
