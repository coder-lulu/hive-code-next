import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  View
} from 'react-native'
import { Minus, MoreHorizontal, Plus, Sparkles } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { MobileSourceControlCreatePrEntry } from './MobileSourceControlCreatePrEntry'
import { MobileCommitFailurePanel } from './MobileCommitFailurePanel'
import {
  KEYBOARD_COMMIT_BAR_CLEARANCE,
  localizeMobileSourceControlCopy
} from './mobile-source-control-screen-state'
import { makeRenderFileRow, BranchCompareFooter } from './MobileSourceControlFileRows'
import type { MobileSourceControlState } from './use-mobile-source-control-state'
import { createMobileSourceControlStyles } from './mobile-source-control-styles'
import { createMobileSourceControlHubStyles } from './mobile-source-control-hub-styles'

type Props = {
  state: MobileSourceControlState
}

// Changes tab: local file changes only — uncommitted (staged/unstaged) plus
// committed-on-branch vs base. PR conflicts and push status live elsewhere.
export function MobileSourceControlContent({ state }: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileSourceControlStyles)
  const hubStyles = useMobileThemeStyles(createMobileSourceControlHubStyles)
  const {
    insets,
    connState,
    busyAction,
    commitMessage,
    setCommitMessage,
    generatingMessage,
    setShowActionSheet,
    setDiscardTarget,
    actionError,
    commitFailureRecovery,
    commitFailureRecoveryAction,
    keyboardLift,
    openingPath,
    openingBranchPath,
    sections,
    hasVisibleChanges,
    stageablePaths,
    unstageablePaths,
    stagedCount,
    primaryAction,
    createPrAction,
    stageAll,
    unstageAll,
    generateCommitMessage,
    cancelGenerateCommitMessage,
    openFile,
    openBranchDiff,
    runGitAction
  } = state
  const ioBusy = busyAction !== null || openingPath !== null || openingBranchPath !== null
  const shouldShowGenerateButton = stagedCount > 0 || generatingMessage
  const createPrHeroActive =
    createPrAction.visible && !createPrAction.disabled && !createPrAction.pushFirst
  const branchCompareFooter = (
    <BranchCompareFooter
      state={{
        shouldShowBranchCompareSection: state.shouldShowBranchCompareSection,
        branchCompareSummaryText: state.branchCompareSummaryText,
        branchEntries: state.branchEntries,
        branchCompareState: state.branchCompareState,
        branchCompareResult: state.branchCompareResult,
        busyAction,
        openBranchDiff,
        openingBranchPath,
        openingPath
      }}
    />
  )

  return (
    <>
      {connState !== 'connected' ? (
        // Why: once data has loaded the screen looks alive even when the
        // desktop link is down, so taps appear to do nothing (STA-1511).
        // Surface the reconnect state where the user is looking.
        <View style={styles.reconnectBanner}>
          <ActivityIndicator size="small" color={theme.color.status.warning} />
          <Text style={styles.reconnectBannerText}>正在重新连接电脑...</Text>
        </View>
      ) : null}
      <View style={hubStyles.changesControls}>
        {commitFailureRecovery ? (
          <MobileCommitFailurePanel
            failure={commitFailureRecovery}
            action={commitFailureRecoveryAction}
          />
        ) : actionError ? (
          <View style={styles.actionError}>
            <Text style={styles.actionErrorText} numberOfLines={2}>
              {actionError}
            </Text>
          </View>
        ) : null}
        <MobileSourceControlCreatePrEntry action={createPrAction} />
        <View style={styles.bulkRow}>
          <Pressable
            style={({ pressed }) => [
              styles.bulkButton,
              (stageablePaths.length === 0 || ioBusy) && styles.bulkButtonDisabled,
              pressed && styles.bulkButtonPressed
            ]}
            onPress={() => void stageAll()}
            disabled={ioBusy || stageablePaths.length === 0}
          >
            {busyAction === 'stage-all' ? (
              <ActivityIndicator size="small" color={theme.color.text.primary} />
            ) : (
              <Plus size={16} color={theme.color.text.primary} strokeWidth={2} />
            )}
            <Text style={styles.bulkButtonText}>全部暂存</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.bulkButton,
              (unstageablePaths.length === 0 || ioBusy) && styles.bulkButtonDisabled,
              pressed && styles.bulkButtonPressed
            ]}
            onPress={() => void unstageAll()}
            disabled={ioBusy || unstageablePaths.length === 0}
          >
            {busyAction === 'unstage-all' ? (
              <ActivityIndicator size="small" color={theme.color.text.primary} />
            ) : (
              <Minus size={16} color={theme.color.text.primary} strokeWidth={2} />
            )}
            <Text style={styles.bulkButtonText}>全部取消暂存</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.bulkMenuButton,
              pressed && styles.bulkButtonPressed,
              ioBusy && styles.bulkButtonDisabled
            ]}
            onPress={() => setShowActionSheet(true)}
            disabled={ioBusy}
            hitSlop={8}
            accessibilityLabel="打开源码控制操作"
          >
            <MoreHorizontal size={20} color={theme.color.text.primary} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      {!hasVisibleChanges ? (
        <View style={styles.state}>
          <Text style={styles.stateTitle}>没有本地更改</Text>
          <Text style={styles.stateText}>工作区没有待处理的更改。</Text>
        </View>
      ) : sections.length === 0 ? (
        // Why: RN SectionList with empty `sections` often skips ListFooterComponent,
        // which hid "Committed on Branch" when only branch files remain.
        <ScrollView style={hubStyles.tabBody} contentContainerStyle={styles.listContent}>
          {branchCompareFooter}
        </ScrollView>
      ) : (
        <SectionList
          style={hubStyles.tabBody}
          sections={sections}
          renderItem={makeRenderFileRow({
            busyAction,
            openingPath,
            openingBranchPath,
            openFile,
            runGitAction,
            setDiscardTarget
          })}
          keyExtractor={(item) => `${item.area}:${item.path}:${item.oldPath ?? ''}`}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {localizeMobileSourceControlCopy(section.title)}
              </Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          ListFooterComponent={branchCompareFooter}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.listContent}
        />
      )}

      <View
        style={[
          styles.commitBar,
          {
            bottom: keyboardLift > 0 ? keyboardLift + KEYBOARD_COMMIT_BAR_CLEARANCE : keyboardLift,
            paddingBottom:
              keyboardLift > 0 ? theme.spacing.space12 : theme.spacing.space12 + insets.bottom
          }
        ]}
      >
        <View style={styles.commitRow}>
          {stagedCount === 0 ? (
            <View
              style={[styles.commitInput, styles.commitInputDisabled]}
              accessibilityRole="text"
              accessibilityState={{ disabled: true }}
              accessibilityLabel="提交说明不可用，没有已暂存文件。"
            >
              <Text style={styles.commitInputDisabledText}>没有已暂存文件</Text>
            </View>
          ) : (
            <TextInput
              style={styles.commitInput}
              value={commitMessage}
              onChangeText={setCommitMessage}
              placeholder="提交说明"
              placeholderTextColor={theme.color.text.tertiary}
              editable={busyAction === null && openingPath === null && openingBranchPath === null}
              returnKeyType="done"
              onSubmitEditing={primaryAction.onPress}
            />
          )}
          {shouldShowGenerateButton ? (
            <Pressable
              style={({ pressed }) => [
                styles.generateButton,
                busyAction !== null && styles.commitButtonDisabled,
                pressed && styles.commitButtonPressed
              ]}
              // Why: commit-message AI belongs to the commit path; hiding it
              // during Stage All keeps the quick action visually unambiguous.
              disabled={busyAction !== null}
              onPress={() =>
                generatingMessage ? cancelGenerateCommitMessage() : void generateCommitMessage()
              }
              accessibilityLabel={generatingMessage ? '取消生成提交说明' : '使用 AI 生成提交说明'}
            >
              {generatingMessage ? (
                <ActivityIndicator size="small" color={theme.color.text.secondary} />
              ) : (
                <Sparkles size={16} color={theme.color.text.secondary} strokeWidth={2} />
              )}
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.commitButton,
              createPrHeroActive && styles.commitButtonSecondary,
              primaryAction.disabled && styles.commitButtonDisabled,
              pressed && styles.commitButtonPressed
            ]}
            onPress={primaryAction.onPress}
            disabled={primaryAction.disabled}
            accessibilityLabel={localizeMobileSourceControlCopy(primaryAction.accessibilityLabel)}
            accessibilityHint={localizeMobileSourceControlCopy(primaryAction.accessibilityHint)}
          >
            {primaryAction.loading ? (
              <ActivityIndicator
                size="small"
                color={createPrHeroActive ? theme.color.text.primary : theme.color.text.inverse}
              />
            ) : (
              <Text
                style={[
                  styles.commitButtonText,
                  createPrHeroActive && styles.commitButtonSecondaryText
                ]}
              >
                {localizeMobileSourceControlCopy(primaryAction.label)}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </>
  )
}
