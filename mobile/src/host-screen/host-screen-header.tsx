import type { ComponentType, ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  Filter,
  FolderKanban,
  Layers,
  List,
  PanelLeftClose,
  Plus,
  Search,
  SlidersHorizontal,
  SquareTerminal,
  UserCircle,
  X
} from 'lucide-react-native'
import { MobileSearchField } from '../components/MobileSearchField'
import { StatusDot } from '../components/StatusDot'
import { presentRuntimeConnection } from '../runtime-directory/runtime-connection-presentation'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { classifyConnection, type ConnectionVerdict } from '../transport/connection-health'
import { projectMobileWorkspaceSummary } from '../worktree/mobile-workspace-summary'
import { createHostScreenStyles } from './host-screen-styles'
import type { HostScreenController } from './use-host-screen-controller'

type SummaryIcon = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>
function isErrorVerdict(verdict: ConnectionVerdict): boolean {
  return (
    verdict.kind === 'warning' || verdict.kind === 'unreachable' || verdict.kind === 'auth-failed'
  )
}

export function HostScreenHeader({ controller }: { controller: HostScreenController }) {
  return controller.embedded ? (
    <EmbeddedHostScreenHeader controller={controller} />
  ) : (
    <PhoneHostScreenHeader controller={controller} />
  )
}

function PhoneHostScreenHeader({ controller }: { controller: HostScreenController }) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createHostScreenStyles)
  const summary = projectMobileWorkspaceSummary(
    controller.displayWorktrees,
    controller.connState === 'connected',
    controller.now
  )
  const runtimeStatus = presentRuntimeConnection(controller.connState)
  const statusColor =
    runtimeStatus.tone === 'success'
      ? theme.color.status.success
      : runtimeStatus.tone === 'warning'
        ? theme.color.status.warning
        : runtimeStatus.tone === 'danger'
          ? theme.color.status.danger
          : theme.color.text.tertiary
  const statusTextStyle =
    runtimeStatus.tone === 'success'
      ? styles.runtimeStatusSuccess
      : runtimeStatus.tone === 'warning'
        ? styles.runtimeStatusWarning
        : runtimeStatus.tone === 'danger'
          ? styles.runtimeStatusDanger
          : undefined

  return (
    <View style={styles.phoneChrome}>
      <View style={styles.phoneHeaderRow}>
        <View style={styles.phoneHeaderSide}>
          <Pressable
            accessibilityLabel={`选择 Runtime，当前为 ${controller.state.hostName || '未命名设备'}，${runtimeStatus.accessibilityLabel}`}
            accessibilityRole="button"
            onPress={() => controller.state.setShowRuntimeSelector(true)}
            style={({ pressed }) => [styles.runtimeButton, pressed && styles.controlPressed]}
          >
            <View style={[styles.runtimeStatusDot, { backgroundColor: statusColor }]} />
            <View style={styles.runtimeCopy}>
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.runtimeButtonText}>
                {controller.state.hostName || 'Runtime'}
              </Text>
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={[styles.runtimeStatusText, statusTextStyle]}
              >
                {runtimeStatus.label}
              </Text>
            </View>
            <ChevronDown color={theme.color.text.secondary} size={16} strokeWidth={1.9} />
          </Pressable>
        </View>

        <View pointerEvents="none" style={styles.phoneHeaderTitleWrap}>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.phoneHeaderTitle}>
            工作区
          </Text>
        </View>

        <View style={[styles.phoneHeaderSide, styles.phoneHeaderRight]}>
          <Pressable
            accessibilityLabel={`筛选工作区${controller.settings.activeFilterCount > 0 ? `，已启用 ${controller.settings.activeFilterCount} 项` : ''}`}
            accessibilityRole="button"
            onPress={() => controller.state.setShowFilterModal(true)}
            style={({ pressed }) => [
              styles.phoneIconButton,
              controller.settings.activeFilterCount > 0 && styles.phoneIconButtonActive,
              pressed && styles.controlPressed
            ]}
          >
            <Filter
              color={
                controller.settings.activeFilterCount > 0
                  ? theme.color.brand.primary
                  : theme.color.text.primary
              }
              size={20}
              strokeWidth={1.9}
            />
          </Pressable>
        </View>
      </View>

      <View style={styles.phoneSearchBar}>
        <MobileSearchField
          accessibilityLabel="搜索工作区、仓库或分支"
          onChangeText={controller.state.setSearch}
          placeholder="搜索工作区、仓库或分支"
          value={controller.state.search}
        />
      </View>

      <View accessibilityLabel="工作区概览" style={styles.workspaceSummary}>
        <WorkspaceSummaryItem
          Icon={FolderKanban}
          label="工作区"
          styles={styles}
          theme={theme}
          value={summary.workspaceCount}
        />
        <View style={styles.workspaceSummaryDivider} />
        <WorkspaceSummaryItem
          Icon={Bot}
          label="运行中"
          styles={styles}
          theme={theme}
          value={summary.runningAgentCount}
        />
        <View style={styles.workspaceSummaryDivider} />
        <WorkspaceSummaryItem
          Icon={CircleAlert}
          label="需处理"
          styles={styles}
          theme={theme}
          value={summary.attentionCount}
        />
      </View>
    </View>
  )
}

function WorkspaceSummaryItem(props: {
  readonly Icon: SummaryIcon
  readonly label: string
  readonly styles: ReturnType<typeof createHostScreenStyles>
  readonly theme: MobileTheme
  readonly value: string
}) {
  const { Icon, label, styles, theme, value } = props
  return (
    <View accessible accessibilityLabel={`${label} ${value}`} style={styles.workspaceSummaryItem}>
      <View style={styles.workspaceSummaryValueRow}>
        <Icon color={theme.color.text.secondary} size={18} strokeWidth={1.9} />
        <Text maxFontSizeMultiplier={1.3} style={styles.workspaceSummaryValue}>
          {value}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.workspaceSummaryLabel}>
        {label}
      </Text>
    </View>
  )
}

function EmbeddedHostScreenHeader({ controller }: { controller: HostScreenController }) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createHostScreenStyles)
  const colors = {
    textPrimary: theme.color.text.primary,
    textSecondary: theme.color.text.secondary
  }
  const {
    actions,
    connState,
    floatingWorkspaceEnabled,
    forceReconnectHost,
    hostId,
    lastConnectedAt,
    onHideSidebar,
    reconnectAttempts,
    relayRecovery,
    settings,
    state
  } = controller
  const headerVerdict = classifyConnection({
    state: connState,
    reconnectAttempts,
    lastConnectedAt,
    ...relayRecovery
  })
  const showReconnectButton =
    connState !== 'connected' &&
    isErrorVerdict(headerVerdict) &&
    hostId &&
    headerVerdict.kind !== 'auth-failed'

  return (
    <View style={styles.topChrome}>
      <View style={styles.statusBar}>
        <Pressable
          accessibilityLabel="返回设备列表"
          accessibilityRole="button"
          hitSlop={8}
          onPress={actions.leaveHost}
          style={styles.backButton}
        >
          <ChevronLeft color={colors.textPrimary} size={22} />
        </Pressable>
        <View style={styles.hostIdentity}>
          <StatusDot state={connState} verdict={headerVerdict} />
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.hostNameText}>
            {state.hostName || 'Runtime'}
          </Text>
        </View>
        {showReconnectButton ? (
          <Pressable
            hitSlop={8}
            onPress={() => void forceReconnectHost(hostId!)}
            style={styles.reconnectButton}
          >
            <Text maxFontSizeMultiplier={1.3} style={styles.reconnectButtonText}>
              重新连接
            </Text>
          </Pressable>
        ) : null}
        {onHideSidebar ? (
          <Pressable
            accessibilityLabel="隐藏侧栏"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onHideSidebar}
            style={styles.sidebarCollapseButton}
          >
            <PanelLeftClose color={colors.textSecondary} size={14} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.embeddedToolbar}>
        <View style={styles.embeddedToolbarRow}>
          <Pressable
            accessibilityLabel="筛选工作区"
            accessibilityRole="button"
            onPress={() => state.setShowFilterModal(true)}
            style={[
              styles.filterChip,
              styles.embeddedFilterChip,
              settings.activeFilterCount > 0 && styles.filterChipActive
            ]}
          >
            <Filter
              color={settings.activeFilterCount > 0 ? colors.textPrimary : colors.textSecondary}
              size={12}
            />
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={[
                styles.filterChipText,
                settings.activeFilterCount > 0 && styles.filterChipTextActive
              ]}
            >
              筛选{settings.activeFilterCount > 0 ? ` ${settings.activeFilterCount}` : ''}
            </Text>
          </Pressable>

          <Pressable
            accessibilityLabel={`排序：${settings.selectedSortLabel}`}
            accessibilityRole="button"
            onPress={() => state.setShowSortPicker(true)}
            style={[styles.modeButton, styles.embeddedModeButton]}
          >
            <SlidersHorizontal color={colors.textSecondary} size={14} />
            <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.sortLabel}>
              {settings.selectedSortLabel}
            </Text>
          </Pressable>

          <Pressable
            accessibilityLabel="工作区分组"
            accessibilityRole="button"
            onPress={() => state.setShowGroupPicker(true)}
            style={[styles.modeButton, styles.embeddedModeButton]}
          >
            <Layers color={colors.textSecondary} size={14} />
          </Pressable>
        </View>

        <View style={styles.embeddedToolbarRow}>
          <EmbeddedIconButton
            accessibilityLabel="账号"
            disabled={connState !== 'connected'}
            onPress={() => actions.navigateFromHostList(`/h/${hostId}/accounts`)}
            styles={styles}
          >
            <UserCircle color={colors.textSecondary} size={16} />
          </EmbeddedIconButton>
          <EmbeddedIconButton
            accessibilityLabel="任务"
            disabled={connState !== 'connected'}
            onPress={() => actions.navigateFromHostList(`/h/${hostId}/tasks`)}
            styles={styles}
          >
            <List color={colors.textSecondary} size={16} />
          </EmbeddedIconButton>
          {floatingWorkspaceEnabled ? (
            <EmbeddedIconButton
              accessibilityLabel="浮动工作区"
              disabled={connState !== 'connected'}
              onPress={actions.openFloatingWorkspace}
              styles={styles}
            >
              <SquareTerminal color={colors.textSecondary} size={18} />
            </EmbeddedIconButton>
          ) : null}
          <EmbeddedIconButton
            accessibilityLabel="新建工作区"
            disabled={connState !== 'connected'}
            onPress={actions.openNewWorktreeModal}
            styles={styles}
          >
            <Plus color={colors.textPrimary} size={16} />
          </EmbeddedIconButton>
          <EmbeddedIconButton
            accessibilityLabel={state.showSearch ? '关闭搜索' : '搜索工作区'}
            onPress={() => state.setShowSearch((visible) => !visible)}
            styles={styles}
          >
            {state.showSearch ? (
              <X color={colors.textSecondary} size={16} />
            ) : (
              <Search color={colors.textSecondary} size={16} />
            )}
          </EmbeddedIconButton>
        </View>
      </View>
    </View>
  )
}

function EmbeddedIconButton(props: {
  readonly accessibilityLabel: string
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly onPress: () => void
  readonly styles: ReturnType<typeof createHostScreenStyles>
}) {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={[
        props.styles.embeddedToolbarIconButton,
        props.disabled && props.styles.toolbarIconDisabled
      ]}
    >
      {props.children}
    </Pressable>
  )
}
