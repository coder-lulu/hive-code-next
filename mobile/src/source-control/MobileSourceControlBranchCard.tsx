import { Pressable, Text, View } from 'react-native'
import { GitBranch } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileSourceControlStyles } from './mobile-source-control-styles'
import { MobileSourceControlPrChip } from './MobileSourceControlPrChip'
import type { MobilePrChipSummary } from './mobile-pr-chip-summary'
import { mobileConflictAbortLabel } from './mobile-source-control-conflict-abort'

type Props = {
  branchLabel: string
  syncLabel: string | null
  unstagedCount: number
  stagedCount: number
  branchCount: number
  conflictOperation: string | null
  // True while any serial git IO is in flight — disables Abort so ops don't race.
  conflictBusy: boolean
  // True only while abort-merge / abort-rebase itself is running (label accuracy).
  conflictAborting: boolean
  onAbortConflict: (operation: string) => void
  // The PR chip is shown only on repos with a hosted-review remote; null hides it.
  prChip: MobilePrChipSummary | null
  onOpenPr: () => void
}

// Persistent card at the top of every hub segment: branch identity, sync/counts,
// conflict state, and the PR chip. Shared so PR/History see the same status the
// Changes lens does without re-deriving it.
export function MobileSourceControlBranchCard({
  branchLabel,
  syncLabel,
  unstagedCount,
  stagedCount,
  branchCount,
  conflictOperation,
  conflictBusy,
  conflictAborting,
  onAbortConflict,
  prChip,
  onOpenPr
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileSourceControlStyles)
  const showConflict = conflictOperation !== null && conflictOperation !== 'unknown'
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <View style={styles.branchLine}>
          <GitBranch size={16} color={theme.color.text.secondary} strokeWidth={2} />
          <Text style={styles.branchText} numberOfLines={1}>
            {branchLabel}
          </Text>
        </View>
        {syncLabel ? <Text style={styles.syncText}>{syncLabel}</Text> : null}
      </View>
      <View style={styles.countRow}>
        <Text style={styles.countText}>{unstagedCount} 个更改</Text>
        <Text style={styles.countText}>{stagedCount} 个已暂存</Text>
        {branchCount > 0 ? <Text style={styles.countText}>分支上 {branchCount} 个</Text> : null}
      </View>
      {/* Own row so Abort never overflows past the card when counts are long. */}
      {showConflict ? (
        <View style={styles.conflictRow}>
          <Text style={styles.conflictText}>
            {conflictOperation === 'merge' ? '合并冲突' : '变基冲突'}
          </Text>
          {conflictOperation === 'merge' || conflictOperation === 'rebase' ? (
            <Pressable
              style={({ pressed }) => [
                styles.abortButton,
                conflictBusy && styles.abortButtonDisabled,
                pressed && !conflictBusy && styles.abortPressed
              ]}
              disabled={conflictBusy}
              onPress={() => onAbortConflict(conflictOperation)}
            >
              <Text style={styles.abortText}>
                {localizeConflictAbortLabel(
                  mobileConflictAbortLabel(conflictOperation, conflictAborting)
                )}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {prChip ? <MobileSourceControlPrChip summary={prChip} onPress={onOpenPr} /> : null}
    </View>
  )
}

function localizeConflictAbortLabel(label: string): string {
  if (label === 'Aborting…') {
    return '正在中止…'
  }
  return label === 'Abort merge' ? '中止合并' : '中止变基'
}
