import { useRef } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Check, ChevronRight, Moon } from 'lucide-react-native'
import { buildWorktreeNavigationActions } from '../agent-history/worktree-navigation-actions'
import { ActionSheetContent } from '../components/ActionSheetModal'
import { BottomDrawer } from '../components/BottomDrawer'
import { ConfirmModal } from '../components/ConfirmModal'
import { NewWorktreeModalController } from '../components/NewWorktreeModalController'
import { PickerModal } from '../components/PickerModal'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { hostNewWorktreeSessionRoute } from '../host-route-action-state'
import { MobileRuntimeSelector } from '../runtime-directory/MobileRuntimeSelector'
import { getWorktreeRowIdentity } from '../worktree/worktree-host-row-identity'
import {
  WORKSPACE_GROUP_OPTIONS as GROUP_OPTIONS,
  WORKSPACE_SORT_OPTIONS as SORT_OPTIONS
} from '../worktree/workspace-list-picker-options'
import { isWorktreePinned } from '../worktree/workspace-list-sections'
import { createHostScreenStyles } from './host-screen-styles'
import type { HostScreenController } from './use-host-screen-controller'

export function HostScreenOverlays({ controller }: { controller: HostScreenController }) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createHostScreenStyles)
  const pendingPickerRef = useRef<'group' | 'sort' | null>(null)
  const {
    actions,
    catalog,
    client,
    existingWorktreePaths,
    hostCapabilities,
    hostId,
    runtimeCatalog,
    runtimeConnectionStates,
    settings,
    showNewWorktree,
    state
  } = controller
  const actionTarget = state.actionTarget

  return (
    <>
      <MobileRuntimeSelector
        catalog={runtimeCatalog}
        connectionStates={runtimeConnectionStates}
        onClose={() => state.setShowRuntimeSelector(false)}
        onPair={() => controller.router.push('/pair-scan')}
        onSelect={(runtimeId) => {
          if (runtimeId !== hostId) {
            controller.router.replace(`/h/${runtimeId}`)
          }
        }}
        selectedId={hostId ?? null}
        theme={theme}
        visible={!controller.embedded && state.showRuntimeSelector}
      />

      <PickerModal
        visible={state.showSortPicker}
        title="排序方式"
        options={SORT_OPTIONS}
        selected={state.sortMode}
        onSelect={settings.handleSortChange}
        onClose={() => state.setShowSortPicker(false)}
      />

      <PickerModal
        visible={state.showGroupPicker}
        title="分组方式"
        options={GROUP_OPTIONS}
        selected={state.groupMode}
        onSelect={settings.handleGroupChange}
        onClose={() => state.setShowGroupPicker(false)}
      />

      <BottomDrawer
        visible={state.showFilterModal}
        onAfterClose={() => {
          const pendingPicker = pendingPickerRef.current
          pendingPickerRef.current = null
          if (pendingPicker === 'sort') {
            state.setShowSortPicker(true)
          } else if (pendingPicker === 'group') {
            state.setShowGroupPicker(true)
          }
        }}
        onClose={() => state.setShowFilterModal(false)}
      >
        <View style={styles.filterModalHeader}>
          <Text maxFontSizeMultiplier={1.3} style={styles.filterModalTitle}>
            筛选与视图
          </Text>
          {settings.activeFilterCount > 0 && (
            <Pressable onPress={settings.clearFilters}>
              <Text maxFontSizeMultiplier={1.3} style={styles.clearFiltersText}>
                清除筛选
              </Text>
            </Pressable>
          )}
        </View>

        <Text maxFontSizeMultiplier={1.3} style={styles.filterSectionLabel}>
          视图
        </Text>
        <View style={styles.filterGroup}>
          <Pressable
            style={styles.filterRow}
            onPress={() => {
              pendingPickerRef.current = 'sort'
              state.setShowFilterModal(false)
            }}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.filterRowText}>
              排序
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.filterRowValue}>
              {settings.selectedSortLabel}
            </Text>
            <ChevronRight color={theme.color.text.tertiary} size={18} strokeWidth={1.9} />
          </Pressable>
          <View style={styles.filterSeparator} />
          <Pressable
            style={styles.filterRow}
            onPress={() => {
              pendingPickerRef.current = 'group'
              state.setShowFilterModal(false)
            }}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.filterRowText}>
              分组
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.filterRowValue}>
              {groupModeLabel(state.groupMode)}
            </Text>
            <ChevronRight color={theme.color.text.tertiary} size={18} strokeWidth={1.9} />
          </Pressable>
        </View>

        <Text maxFontSizeMultiplier={1.3} style={styles.filterSectionLabel}>
          工作区
        </Text>
        <View style={styles.filterGroup}>
          <Pressable style={styles.filterRow} onPress={settings.toggleHideSleeping}>
            <Text maxFontSizeMultiplier={1.3} style={styles.filterRowText}>
              隐藏休眠工作区
            </Text>
            {state.filters.hideSleeping && (
              <Check size={16} color={theme.color.text.primary} strokeWidth={2} />
            )}
          </Pressable>
          <View style={styles.filterSeparator} />
          <Pressable style={styles.filterRow} onPress={settings.toggleHideDefaultBranch}>
            <Text maxFontSizeMultiplier={1.3} style={styles.filterRowText}>
              隐藏默认分支
            </Text>
            {state.filters.hideDefaultBranch && (
              <Check size={16} color={theme.color.text.primary} strokeWidth={2} />
            )}
          </Pressable>
        </View>

        {controller.sectionsResult.uniqueRepos.length > 1 && (
          <>
            <Text maxFontSizeMultiplier={1.3} style={styles.filterSectionLabel}>
              代码仓库
            </Text>
            <View style={styles.filterGroup}>
              {controller.sectionsResult.uniqueRepos.map((repo, i) => (
                <View key={repo.id}>
                  {i > 0 && <View style={styles.filterSeparator} />}
                  <Pressable
                    style={styles.filterRow}
                    onPress={() => settings.toggleRepoFilter(repo.id)}
                  >
                    <View style={[styles.filterRepoDot, { backgroundColor: repo.color }]} />
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={styles.filterRowText}
                      numberOfLines={1}
                    >
                      {repo.name}
                    </Text>
                    {state.filters.filterRepoIds.has(repo.id) && (
                      <Check size={16} color={theme.color.text.primary} strokeWidth={2} />
                    )}
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
      </BottomDrawer>

      {/* Worktree long-press action sheet (inline confirm to avoid double-Modal lag) */}
      <BottomDrawer
        visible={actionTarget != null}
        onClose={() => {
          state.setConfirmDelete(null)
          state.setActionTarget(null)
        }}
      >
        {state.confirmDelete ? (
          <View>
            <View style={styles.confirmContent}>
              <Text maxFontSizeMultiplier={1.3} style={styles.confirmTitle}>
                删除工作区
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.confirmMessage}>
                确定删除“{state.confirmDelete.displayName || state.confirmDelete.repo}”（
                {state.confirmDelete.branch}）吗？
              </Text>
            </View>
            <View style={styles.confirmButtons}>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmBtn,
                  styles.confirmBtnCancel,
                  pressed && styles.confirmBtnPressed
                ]}
                onPress={() => state.setConfirmDelete(null)}
              >
                <Text maxFontSizeMultiplier={1.3} style={styles.confirmBtnCancelText}>
                  取消
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.confirmBtn,
                  styles.confirmBtnDestructive,
                  pressed && styles.confirmBtnPressed
                ]}
                onPress={() => {
                  if (state.confirmDelete) {
                    void actions.handleDeleteWorktree(state.confirmDelete)
                  }
                  state.setConfirmDelete(null)
                  state.setActionTarget(null)
                }}
              >
                <Text maxFontSizeMultiplier={1.3} style={styles.confirmBtnDestructiveText}>
                  删除
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <ActionSheetContent
            title={actionTarget ? actionTarget.displayName || actionTarget.repo : undefined}
            message={actionTarget?.branch}
            actions={
              actionTarget
                ? [
                    ...buildWorktreeNavigationActions({
                      hostId,
                      worktreeId: actionTarget.worktreeId,
                      worktreeName: actionTarget.displayName || actionTarget.repo,
                      hostCapabilities,
                      navigate: actions.navigateFromHostList,
                      onDone: () => state.setActionTarget(null)
                    }).map((action) => ({
                      ...action,
                      label: localizedActionLabel(action.label)
                    })),
                    {
                      label: '休眠',
                      icon: Moon,
                      onPress: () => {
                        if (client) {
                          state.setSleptIds((prev) =>
                            new Set(prev).add(getWorktreeRowIdentity(actionTarget))
                          )
                          void client
                            .sendRequest('worktree.sleep', {
                              worktree: `id:${actionTarget.worktreeId}`
                            })
                            .catch(() => null)
                        }
                        state.setActionTarget(null)
                      }
                    },
                    {
                      label: isWorktreePinned(actionTarget, state.pinnedIds) ? '取消置顶' : '置顶',
                      onPress: () => {
                        actions.togglePin(actionTarget.worktreeId)
                        state.setActionTarget(null)
                      }
                    },
                    {
                      label: '删除',
                      destructive: true,
                      onPress: () => state.setConfirmDelete(actionTarget)
                    }
                  ]
                : []
            }
          />
        )}
      </BottomDrawer>

      {/* Host remove confirmation */}
      <ConfirmModal
        visible={state.confirmRemoveHost && controller.canRemoveHost}
        title="移除 Runtime"
        message={`确定移除“${state.hostName}”吗？之后仍可重新配对。`}
        confirmLabel="移除"
        destructive
        onConfirm={() => void actions.handleRemoveHost()}
        onCancel={() => state.setConfirmRemoveHost(false)}
      />

      <NewWorktreeModalController
        ref={state.newWorktreeModalRef}
        routeVisible={showNewWorktree}
        client={client}
        hostId={hostId}
        existingWorktreePaths={existingWorktreePaths}
        existingWorktrees={state.worktrees}
        onVisibleChange={(visible) => {
          state.newWorktreeModalVisibleRef.current = visible
        }}
        onCreated={(worktreeId, worktreeName) => {
          void catalog.fetchWorktrees({ allowDuringModal: true })
          actions.navigateFromHostList(
            hostNewWorktreeSessionRoute(hostId, worktreeId, worktreeName)
          )
        }}
        onRouteVisibleChange={actions.setShowNewWorktreeVisible}
      />
    </>
  )
}

function groupModeLabel(mode: HostScreenController['state']['groupMode']): string {
  if (mode === 'none') {
    return '不分组'
  }
  if (mode === 'workspaceStatus') {
    return '状态'
  }
  if (mode === 'repo') {
    return '代码仓库'
  }
  return 'PR 状态'
}

function localizedActionLabel(label: string): string {
  if (label === 'Source Control') {
    return '源代码管理'
  }
  if (label === 'Agent Session History') {
    return 'Agent 会话历史'
  }
  return label
}
