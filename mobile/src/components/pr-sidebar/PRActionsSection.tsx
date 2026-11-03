import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { GitMerge, Link2Off } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../../theme/mobile-theme-provider'
import type { GitHubPRMergeMethod, PRInfo } from '../../../../src/shared/github/pull-request-types'
import type { RpcClient } from '../../transport/rpc-client'
import type { MobilePrActions } from '../../session/use-mobile-pr-actions'
import { unlinkMobilePr } from '../../source-control/mobile-pr-link'
import type { GitHubLinkBase } from '../../../../src/shared/worktree/github-link-base'
import { ConfirmModal } from '../ConfirmModal'
import { canShowMobilePRAutoMergeControl } from './pr-auto-merge-availability'
import { resolveMobilePrMergeMethod, resolvePrActionAvailability } from './pr-actions-state'
import { createPrActionsStyles } from './pr-actions-styles'

type Props = {
  githubLinkBase: GitHubLinkBase | null
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
export function PRActionsSection({
  pr,
  actions,
  client,
  worktreeId,
  githubLinkBase,
  onUnlinked
}: Props) {
  const t = useMobileTranslation()

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
      const outcome = await unlinkMobilePr(client, worktreeId, pr.number, githubLinkBase)
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
  }, [client, githubLinkBase, onUnlinked, pr.number, unlinking, worktreeId])

  const confirmCopy = (): { title: string; message: string; confirmLabel: string } => {
    if (confirm?.kind === 'merge') {
      return {
        title: t(
          'auto.mobile.src.components.pr.sidebar.PRActionsSection.3859e72a1b',
          'Merge pull request?'
        ),
        message: t(
          'auto.mobile.src.components.pr.sidebar.PRActionsSection.0272332d31',
          'This will merge #{{value0}} into the target branch.',
          { value0: pr.number }
        ),
        confirmLabel: '合并'
      }
    }
    if (confirm?.kind === 'state' && confirm.state === 'closed') {
      return {
        title: t(
          'auto.mobile.src.components.pr.sidebar.PRActionsSection.37e70bd3e7',
          'Close pull request?'
        ),
        message: t(
          'auto.mobile.src.components.pr.sidebar.PRActionsSection.5658233062',
          '#{{value0}} will be closed without merging.',
          { value0: pr.number }
        ),
        confirmLabel: '关闭'
      }
    }
    return {
      title: t(
        'auto.mobile.src.components.pr.sidebar.PRActionsSection.fc844409f0',
        'Reopen pull request?'
      ),
      message: t(
        'auto.mobile.src.components.pr.sidebar.PRActionsSection.f41a1dc00b',
        '#{{value0}} will be reopened.',
        { value0: pr.number }
      ),
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
          accessibilityLabel={t(
            'auto.mobile.src.components.pr.sidebar.PRActionsSection.13774d4e6e',
            'Merge pull request'
          )}
        >
          {mergeBusy ? (
            <ActivityIndicator color={theme.color.text.inverse} />
          ) : (
            <GitMerge size={16} color={theme.color.text.inverse} strokeWidth={2.2} />
          )}
          <Text style={[styles.actionButtonText, styles.actionButtonTextMerge]}>
            {t(
              'auto.mobile.src.components.pr.sidebar.PRActionsSection.13774d4e6e',
              'Merge pull request'
            )}
          </Text>
        </Pressable>
      ) : null}

      {showAutoMerge ? (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>
            {t(
              'auto.mobile.src.components.pr.sidebar.PRActionsSection.744ac0d1de',
              'Automatically merge when ready'
            )}
          </Text>
          <Pressable
            style={[styles.togglePill, autoMerge && styles.togglePillOn]}
            onPress={() => {
              setUnlinkError(null)
              actions.setAutoMerge(!autoMerge, effectiveMethod)
            }}
            disabled={autoMergeBusy}
            accessibilityRole="switch"
            accessibilityState={{ checked: autoMerge }}
            accessibilityLabel={t(
              'pullRequest.prActionsSection.autoMergeAccessibilityLabel',
              'Toggle auto-merge'
            )}
          >
            {autoMergeBusy ? (
              <ActivityIndicator color={theme.color.text.secondary} />
            ) : (
              <Text style={[styles.togglePillText, autoMerge && styles.togglePillTextOn]}>
                {autoMerge
                  ? t('settings.nativeChatSettingsScreen.on', 'On')
                  : t('settings.nativeChatSettingsScreen.off', 'Off')}
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
              accessibilityLabel={
                avail.canClose
                  ? t(
                      'auto.mobile.src.components.pr.sidebar.PRActionsSection.d3178a0634',
                      'Close pull request'
                    )
                  : t(
                      'auto.mobile.src.components.pr.sidebar.PRActionsSection.bf6523841f',
                      'Reopen pull request'
                    )
              }
            >
              {stateBusy ? <ActivityIndicator color={theme.color.text.secondary} /> : null}
              <Text
                style={[
                  styles.actionButtonText,
                  avail.canClose && styles.actionButtonDestructiveText
                ]}
              >
                {avail.canClose
                  ? t('settings.nativeChatSettingsScreen.off', 'Off')
                  : t(
                      'auto.mobile.src.components.pr.sidebar.PRActionsSection.3a450459f0',
                      'Reopen'
                    )}
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
              accessibilityLabel={t(
                'auto.mobile.src.components.pr.sidebar.PRActionsSection.f90930772d',
                'Unlink pull request'
              )}
            >
              {unlinking ? (
                <ActivityIndicator color={theme.color.text.secondary} />
              ) : (
                <Link2Off size={16} color={theme.color.text.secondary} strokeWidth={2.2} />
              )}
              <Text style={styles.actionButtonText}>
                {t('pullRequest.prActionsSection.unlinkButton', 'Unlink')}
              </Text>
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
