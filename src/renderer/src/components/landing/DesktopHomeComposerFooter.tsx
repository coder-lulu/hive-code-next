import {
  Check,
  ChevronDown,
  ClipboardCheck,
  CircleCheck,
  Code2,
  FolderGit2,
  Mic,
  Plus,
  SendHorizontal,
  ShieldCheck
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  supportsTuiAgentLaunchPermission,
  type AgentLaunchPermissionMode
} from '../../../../shared/tui-agent-permissions'
import AgentCombobox from '@/components/agent/AgentCombobox'
import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import type { DesktopHomeModel, DesktopHomeProjectGroup } from './desktop-home-model'
import { desktopHomeProjectSelectionValue } from './desktop-home-selection'
import {
  createDesktopHomeContextOptions,
  createDesktopHomePermissionOptions,
  createDesktopHomeQualityOptions,
  createDesktopHomeTaskModeOptions,
  createDesktopHomeTaskTypeOptions,
  type DesktopHomeInlineOption
} from './desktop-home-composer-options'
import { translate } from '@/i18n/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

function collectGroupLabels(
  groups: readonly DesktopHomeProjectGroup[],
  labels: Map<string, string>,
  parentLabel = ''
): void {
  for (const group of groups) {
    const label = parentLabel ? `${parentLabel} / ${group.name}` : group.name
    labels.set(group.identityKey, label)
    collectGroupLabels(group.childGroups, labels, label)
  }
}

function InlineDropdown<Value extends string>({
  value,
  options,
  icon,
  ariaLabel,
  onChange,
  className = '',
  contentClassName = '',
  revealFullLabelOnHover = false
}: {
  value: Value
  options: DesktopHomeInlineOption<Value>[]
  icon: ReactNode
  ariaLabel: string
  onChange: (value: Value) => void
  className?: string
  contentClassName?: string
  revealFullLabelOnHover?: boolean
}): React.JSX.Element {
  const selected = options.find((option) => option.value === value) ?? options[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`desktop-home-composer-select ${className}`}
          aria-label={ariaLabel}
        >
          {icon}
          <span className="truncate" title={revealFullLabelOnHover ? selected?.label : undefined}>
            {selected?.label}
          </span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className={`min-w-[190px] rounded-[12px] border-border bg-popover p-2 text-popover-foreground shadow-[0_16px_48px_rgba(13,15,18,0.14)] backdrop-blur-none ${contentClassName}`}
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            disabled={option.disabled}
            onSelect={() => onChange(option.value)}
            className="min-h-11 gap-3 px-3 py-2 text-[13px]"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate" title={revealFullLabelOnHover ? option.label : undefined}>
                {option.label}
              </span>
              {option.description ? (
                <span className="truncate text-[11px] text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
            {option.value === value ? <Check className="size-3.5 text-[#2f6bff]" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type DesktopHomeComposerFooterProps = {
  allowTemporarySession?: boolean
  model: DesktopHomeModel
  selectedWorkspaceId: string
  onWorkspaceChange: (workspaceId: string) => void
  agent: TuiAgent | null
  agents: AgentCatalogEntry[]
  onAgentChange: (agent: TuiAgent | null) => void
  defaultAgent: TuiAgent | 'blank' | null
  onSetDefaultAgent: (agent: TuiAgent | 'blank' | null) => void
  onOpenAgentSettings: () => void
  permissionMode: AgentLaunchPermissionMode
  onPermissionChange: (mode: AgentLaunchPermissionMode) => void
  hasDraft: boolean
  onSubmit: () => void
}

export function DesktopHomeComposerFooter({
  allowTemporarySession = true,
  model,
  selectedWorkspaceId,
  onWorkspaceChange,
  agent,
  agents,
  onAgentChange,
  defaultAgent,
  onSetDefaultAgent,
  onOpenAgentSettings,
  permissionMode,
  onPermissionChange,
  hasDraft,
  onSubmit
}: DesktopHomeComposerFooterProps): React.JSX.Element {
  useTranslation()
  const [quality, setQuality] = useState('balanced')
  const [taskType, setTaskType] = useState('code')
  const [taskMode, setTaskMode] = useState('task')
  const [contextOpen, setContextOpen] = useState(false)
  const groupLabels = useMemo(() => {
    const labels = new Map<string, string>()
    collectGroupLabels(model.groups, labels)
    if (model.ungrouped.projects.length > 0 || model.ungrouped.folderWorkspaces.length > 0) {
      labels.set(
        model.ungrouped.identityKey,
        translate('components.desktopHome.ungrouped', 'Ungrouped')
      )
    }
    return labels
  }, [model.groups, model.ungrouped])
  const taskTypeOptions = createDesktopHomeTaskTypeOptions()
  const taskModeOptions = createDesktopHomeTaskModeOptions()
  const qualityOptions = createDesktopHomeQualityOptions()
  const contextOptions = createDesktopHomeContextOptions()
  const workspaceOptions: DesktopHomeInlineOption[] = [
    {
      value: '',
      label: allowTemporarySession
        ? translate('components.desktopHome.composer.temporarySession', 'Temporary session')
        : translate('components.desktopHome.composer.selectHostWorkspace', 'Select Host workspace'),
      disabled: !allowTemporarySession,
      description: allowTemporarySession
        ? translate(
            'components.desktopHome.composer.temporarySessionDescription',
            'Start in a temporary space without a project'
          )
        : undefined
    },
    ...model.projects.map((project) => ({
      value: desktopHomeProjectSelectionValue(project.identityKey),
      label: project.name,
      description: `${
        (project.projectGroupId
          ? groupLabels.get(`${project.executionHostId}|project-group:${project.projectGroupId}`)
          : undefined) ?? translate('components.desktopHome.ungrouped', 'Ungrouped')
      } · ${translate('components.desktopHome.composer.projectOptionDescription', 'Project · {{count}} workspaces', { count: project.workspaceCount })}`
    })),
    ...model.recentWorkspaces.map((workspace) => ({
      // The same raw worktree/folder id can exist on more than one host;
      // keep the selector value host-qualified so choosing a row cannot
      // silently activate the wrong runtime.
      value: workspace.identityKey,
      label: `${workspace.repoName} / ${workspace.name}`,
      description: `${workspace.branch} · ${translate(
        `components.desktopHome.host.${workspace.hostLabel}`,
        workspace.hostLabel
      )}`
    }))
  ]
  const permissionSupported = agent !== null && supportsTuiAgentLaunchPermission(agent)
  const permissionOptions = createDesktopHomePermissionOptions(permissionSupported)
  return (
    <div className="desktop-home-composer-footer">
      <div className="desktop-home-composer-toolbar">
        <div className="desktop-home-composer-leading">
          <DropdownMenu open={contextOpen} onOpenChange={setContextOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="desktop-home-composer-icon"
                aria-label={translate('components.desktopHome.composer.addContext', 'Add context')}
                title={translate('components.desktopHome.composer.addContext', 'Add context')}
              >
                <Plus className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className="min-w-[180px] rounded-[12px] border-border bg-popover p-2 text-popover-foreground shadow-[0_16px_48px_rgba(13,15,18,0.14)] backdrop-blur-none"
            >
              {contextOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => setContextOpen(false)}
                  className="min-h-11 px-3 text-[13px]"
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <InlineDropdown
            value={taskType}
            options={taskTypeOptions}
            icon={<Code2 className="size-5" />}
            ariaLabel={translate('components.desktopHome.composer.taskType', 'Task type')}
            onChange={setTaskType}
          />
          <InlineDropdown
            value={taskMode}
            options={taskModeOptions}
            icon={<ClipboardCheck className="size-5" />}
            ariaLabel={translate('components.desktopHome.composer.taskMode', 'Task mode')}
            onChange={setTaskMode}
          />
        </div>
        <div className="desktop-home-composer-actions">
          <InlineDropdown
            value={quality}
            options={qualityOptions}
            icon={<CircleCheck className="size-5" />}
            ariaLabel={translate(
              'components.desktopHome.composer.executionQuality',
              'Execution quality'
            )}
            onChange={setQuality}
          />
          <button
            type="button"
            className="desktop-home-composer-icon"
            aria-label={translate('components.desktopHome.composer.voice', 'Voice input')}
            title={translate('components.desktopHome.composer.voice', 'Voice input')}
          >
            <Mic className="size-5" />
          </button>
          <button
            type="button"
            className="desktop-home-send"
            disabled={!hasDraft}
            onClick={onSubmit}
            aria-label={translate('components.desktopHome.composer.send', 'Send task')}
          >
            <SendHorizontal className="size-5" />
          </button>
        </div>
      </div>
      <div className="desktop-home-composer-context">
        <InlineDropdown
          value={selectedWorkspaceId}
          options={workspaceOptions}
          icon={<FolderGit2 className="size-5" />}
          ariaLabel={translate(
            'components.desktopHome.composer.selectProjectOrWorkspace',
            'Select project or workspace'
          )}
          onChange={onWorkspaceChange}
          className="desktop-home-context-trigger desktop-home-project-trigger"
          contentClassName="max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] w-max min-w-[min(280px,calc(100vw-1rem))] max-w-[min(420px,calc(100vw-1rem))]"
          revealFullLabelOnHover
        />
        <div className="desktop-home-agent-picker">
          <AgentCombobox
            agents={agents}
            value={agent}
            onValueChange={onAgentChange}
            onOpenManageAgents={onOpenAgentSettings}
            defaultAgent={defaultAgent}
            onSetDefault={onSetDefaultAgent}
            allowNarrowTrigger
            allowBlankTerminal={false}
            contentClassName="min-w-[18rem]"
            emptyLabel={translate(
              'components.desktopHome.composer.noInstalledAgents',
              'No installed agents detected'
            )}
            triggerClassName="desktop-home-context-trigger"
          />
        </div>
        <InlineDropdown
          value={permissionSupported ? permissionMode : 'default'}
          options={permissionOptions}
          icon={<ShieldCheck className="size-5" />}
          ariaLabel={translate('components.desktopHome.composer.permission', 'Permission mode')}
          onChange={onPermissionChange}
          className="desktop-home-context-trigger"
        />
      </div>
    </div>
  )
}
