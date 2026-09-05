import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native'
import { ChevronDown, ChevronRight, Pin } from 'lucide-react-native'
import { AuthFailedBanner } from '../components/AuthFailedBanner'
import { HostDiagnosticsLink } from '../components/HostDiagnosticsLink'
import { HostRouteNoticeBanner } from '../components/HostRouteNoticeBanner'
import { MobileRepoIcon } from '../components/MobileRepoIcon'
import { MobileSearchField } from '../components/MobileSearchField'
import { NewWorkspaceFab } from '../components/NewWorkspaceFab'
import { WorktreeListRow } from '../components/WorktreeListRow'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { getWorktreeRowIdentity } from '../worktree/worktree-host-row-identity'
import { HostWorkspaceListStates } from '../worktree/host-workspace-list-states'
import { getWorktreeStatus } from '../worktree/workspace-list-sections'
import { repoColor } from '../worktree/repo-color'
import { createHostScreenStyles } from './host-screen-styles'
import type { HostScreenController } from './use-host-screen-controller'

export function HostWorkspaceList({ controller }: { controller: HostScreenController }) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createHostScreenStyles)
  const {
    actions,
    activeWorktreeScroll,
    catalog,
    connState,
    contentMaxWidth,
    displayWorktrees,
    embedded,
    forceReconnectHost,
    hostId,
    isReadOnly,
    isWideLayout,
    noticeParam,
    now,
    reconnectAttempts,
    relayRecovery,
    routeNotice,
    router,
    sectionsResult,
    setDismissedNotice,
    settings,
    state
  } = controller
  const { rawSections, sections, uniqueRepoColors } = sectionsResult

  return (
    <View style={styles.workspaceList}>
      {/* Auth failed: a latched relay rejection must reach the same re-pair affordance. */}
      {(connState === 'auth-failed' || relayRecovery.pairingRejected) && (
        <AuthFailedBanner
          canRetry={!!hostId}
          copy={{
            message: '身份验证失败。请先重试连接；若仍失败，请从桌面端重新配对。',
            retry: '重试',
            retryAccessibility: '重试身份验证',
            repair: '重新配对',
            repairAccessibility: '重新配对这台电脑',
            remove: '移除',
            removeAccessibility: '移除这台电脑'
          }}
          onRetry={() => hostId && void forceReconnectHost(hostId)}
          onRepair={() => router.push('/pair-scan')}
          onRemove={controller.canRemoveHost ? () => state.setConfirmRemoveHost(true) : undefined}
        />
      )}

      {connState !== 'connected' &&
      !relayRecovery.pairingRejected &&
      reconnectAttempts >= 3 &&
      hostId ? (
        <HostDiagnosticsLink
          onPress={() =>
            router.push({ pathname: '/connection-log', params: { hostId: String(hostId) } })
          }
        />
      ) : null}

      {/* Why a bounced route landed here (e.g. the workspace was deleted on the desktop). */}
      {routeNotice && (
        <HostRouteNoticeBanner
          message={routeNotice}
          onDismiss={() => setDismissedNotice(noticeParam ?? null)}
        />
      )}

      {/* Search bar */}
      {embedded && state.showSearch && (
        <View style={styles.searchBar}>
          <MobileSearchField
            value={state.search}
            onChangeText={state.setSearch}
            placeholder="搜索工作区…"
            autoFocus
            // Why: new key per open remounts the focus effect across rapid toggles so the keyboard reappears.
            focusKey={state.showSearch}
            accessibilityLabel="搜索工作区"
          />
        </View>
      )}

      <HostWorkspaceListStates
        connState={connState}
        worktreesLoaded={state.worktreesLoaded}
        displayCount={displayWorktrees.length}
        sectionCount={sections.length}
        catalogError={state.catalogError}
        theme={theme}
        search={state.search}
        activeFilterCount={settings.activeFilterCount}
      />

      {sections.length > 0 && (
        <SectionList
          style={styles.workspaceList}
          ref={activeWorktreeScroll.sectionListRef}
          sections={sections}
          keyExtractor={(w) => w.sectionListKey ?? getWorktreeRowIdentity(w)}
          stickySectionHeadersEnabled={false}
          // Why: keep the search IME up while tapping clear / scrolling results.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScrollToIndexFailed={activeWorktreeScroll.onScrollToIndexFailed}
          // Why: edge-to-edge under the system nav bar; insets.bottom keeps the last row above it.
          contentContainerStyle={[
            styles.list,
            // Reserve room so the last row stays tappable above the phone's floating "+" (embedded uses the toolbar +).
            {
              paddingBottom: embedded
                ? theme.spacing.space16
                : theme.size.floatingActionButtonSize + theme.spacing.space24
            },
            isWideLayout &&
              !embedded && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }
          ]}
          renderSectionHeader={({ section }) => {
            if (!section.title) {
              return null
            }
            const isCollapsed = state.collapsedGroups.has(section.key)
            const rawSection = rawSections.find((s) => s.key === section.key)
            const count = rawSection?.data.length ?? 0
            const repoSectionColor =
              state.groupMode === 'repo' ? uniqueRepoColors.get(section.title) : null
            const repoSectionIcon =
              state.groupMode === 'repo' ? state.repoIconsByName.get(section.title) : null
            const localizedTitle = localizedSectionTitle(section.title)
            return (
              <Pressable
                accessibilityLabel={`${localizedTitle}，${count} 个工作区，${isCollapsed ? '已折叠' : '已展开'}`}
                accessibilityRole="button"
                accessibilityState={{ expanded: !isCollapsed }}
                onPress={() => settings.toggleCollapsed(section.key)}
                style={({ pressed }) => [styles.sectionHeader, pressed && styles.controlPressed]}
              >
                {isCollapsed ? (
                  <ChevronRight
                    size={16}
                    color={theme.color.text.tertiary}
                    strokeWidth={2}
                    style={styles.sectionIcon}
                  />
                ) : (
                  <ChevronDown
                    size={16}
                    color={theme.color.text.tertiary}
                    strokeWidth={2}
                    style={styles.sectionIcon}
                  />
                )}
                {section.icon === 'pin' && (
                  <Pin
                    size={16}
                    color={theme.color.text.tertiary}
                    strokeWidth={2}
                    style={styles.sectionIcon}
                  />
                )}
                {state.groupMode === 'repo' ? (
                  <View style={styles.sectionRepoIcon}>
                    <MobileRepoIcon
                      repoIcon={repoSectionIcon}
                      size={14}
                      color={repoSectionColor ?? theme.color.text.secondary}
                    />
                  </View>
                ) : null}
                <Text maxFontSizeMultiplier={1.3} style={styles.sectionTitle}>
                  {localizedTitle}
                </Text>
                <Text maxFontSizeMultiplier={1.3} style={styles.sectionCount}>
                  {count}
                </Text>
              </Pressable>
            )
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          // Why (#8498): manual pull-to-refresh forces a fresh snapshot after a stale-cache reconnect.
          refreshControl={
            <RefreshControl
              refreshing={catalog.refreshing}
              onRefresh={catalog.onRefresh}
              tintColor={theme.color.text.secondary}
              colors={[theme.color.text.secondary]}
            />
          }
          renderItem={({ item }) => (
            <WorktreeListRow
              theme={theme}
              item={item}
              isReadOnly={isReadOnly}
              now={now}
              status={getWorktreeStatus(item)}
              repoColor={uniqueRepoColors.get(item.repo) ?? repoColor(item.repo)}
              repoIcon={state.repoIconsByName.get(item.repo) ?? null}
              hideRepo={state.groupMode === 'repo'}
              onPress={actions.openWorktreeSession}
              onLongPress={
                item.workspaceKind === 'folder-workspace' ? undefined : state.setActionTarget
              }
              onToggleLineage={settings.toggleWorktreeLineage}
            />
          )}
        />
      )}

      {/* Floating "new workspace" button — phone only; embedded sidebars keep the toolbar +. */}
      {!embedded && (
        <NewWorkspaceFab
          theme={theme}
          onPress={actions.openNewWorktreeModal}
          disabled={connState !== 'connected'}
        />
      )}
    </View>
  )
}

const SECTION_LABELS: Readonly<Record<string, string>> = {
  All: '全部',
  Closed: '已关闭',
  Done: '已完成',
  'In Progress': '进行中',
  'In Review': '审核中',
  Pinned: '置顶',
  Todo: '待办'
}

function localizedSectionTitle(title: string): string {
  return SECTION_LABELS[title] ?? title
}
