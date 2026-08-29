import {
  Bot,
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
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { DesktopHomeModel } from './desktop-home-model'
import { translate } from '@/i18n/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

type InlineOption = { value: string; label: string; description?: string }

function InlineDropdown({
  value,
  options,
  icon,
  ariaLabel,
  onChange,
  className = ''
}: {
  value: string
  options: InlineOption[]
  icon: ReactNode
  ariaLabel: string
  onChange: (value: string) => void
  className?: string
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
          <span className="truncate">{selected?.label}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="min-w-[190px] rounded-[12px] border-[#DDE1E6] bg-white p-2 shadow-[0_16px_48px_rgba(13,15,18,0.14)] backdrop-blur-none"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className="min-h-11 gap-3 px-3 py-2 text-[13px]"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{option.label}</span>
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
  model: DesktopHomeModel
  selectedWorkspaceId: string
  onWorkspaceChange: (workspaceId: string) => void
  agent: TuiAgent
  enabledAgents: { id: TuiAgent; label: string }[]
  onAgentChange: (agent: TuiAgent) => void
  permissionMode: string
  onPermissionChange: (mode: string) => void
  hasDraft: boolean
  onSubmit: () => void
}

export function DesktopHomeComposerFooter({
  model,
  selectedWorkspaceId,
  onWorkspaceChange,
  agent,
  enabledAgents,
  onAgentChange,
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
  const taskTypeOptions: InlineOption[] = [
    { value: 'code', label: '代码开发' },
    { value: 'analysis', label: '需求分析' },
    { value: 'architecture', label: '架构设计' },
    { value: 'review', label: '代码审查' },
    { value: 'debug', label: '调试排错' },
    { value: 'tests', label: '测试生成' },
    { value: 'docs', label: '文档整理' }
  ]
  const taskModeOptions: InlineOption[] = [
    { value: 'task', label: '任务模式', description: '形成执行步骤并推进任务' },
    { value: 'chat', label: '对话模式', description: '以问答和分析为主' },
    { value: 'plan', label: '规划模式', description: '只生成计划，等待确认' },
    { value: 'execute', label: '执行模式', description: '执行已确认的任务' },
    { value: 'review', label: '审查模式', description: '分析代码、Diff 或结果' }
  ]
  const qualityOptions: InlineOption[] = [
    { value: 'fast', label: '快速', description: '适合简单修改和小范围任务' },
    { value: 'balanced', label: '均衡', description: '兼顾速度、范围和结果质量' },
    { value: 'deep', label: '深度', description: '适合复杂分析和多步骤开发' }
  ]
  const contextOptions: InlineOption[] = [
    { value: 'file', label: '文件' },
    { value: 'folder', label: '文件夹' },
    { value: 'project', label: '项目' },
    { value: 'worktree', label: 'Worktree' },
    { value: 'diff', label: 'Git Diff' },
    { value: 'recent', label: '最近文件' },
    { value: 'terminal', label: '终端输出' },
    { value: 'image', label: '图片' },
    { value: 'issue', label: '任务或 Issue' }
  ]
  const workspaceOptions: InlineOption[] =
    model.recentWorkspaces.length === 0
      ? [{ value: '', label: 'AIWriteX / 33' }]
      : model.recentWorkspaces.map((workspace) => ({
          value: workspace.id,
          label: `${workspace.repoName} / ${workspace.name}`,
          description: `${workspace.branch} · ${workspace.hostLabel}`
        }))
  const agentOptions = enabledAgents.map((entry) => ({ value: entry.id, label: entry.label }))
  const permissionOptions: InlineOption[] = [
    { value: 'default', label: '默认权限' },
    { value: 'ask', label: '始终询问' },
    { value: 'auto', label: '自动批准' }
  ]
  return (
    <div className="desktop-home-composer-footer">
      <div className="desktop-home-composer-toolbar">
        <div className="desktop-home-composer-leading">
          <DropdownMenu open={contextOpen} onOpenChange={setContextOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="desktop-home-composer-icon"
                aria-label={translate('components.desktopHome.composer.addContext', '添加上下文')}
                title={translate('components.desktopHome.composer.addContext', '添加上下文')}
              >
                <Plus className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className="min-w-[180px] rounded-[12px] border-[#DDE1E6] bg-white p-2 shadow-[0_16px_48px_rgba(13,15,18,0.14)] backdrop-blur-none"
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
            ariaLabel="任务类型"
            onChange={setTaskType}
          />
          <InlineDropdown
            value={taskMode}
            options={taskModeOptions}
            icon={<ClipboardCheck className="size-5" />}
            ariaLabel="任务模式"
            onChange={setTaskMode}
          />
        </div>
        <div className="desktop-home-composer-actions">
          <InlineDropdown
            value={quality}
            options={qualityOptions}
            icon={<CircleCheck className="size-5" />}
            ariaLabel="执行质量"
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
          ariaLabel={translate('components.desktopHome.composer.selectWorkspace', '选择工作区')}
          onChange={onWorkspaceChange}
          className="desktop-home-context-trigger"
        />
        <InlineDropdown
          value={agent}
          options={agentOptions}
          icon={<Bot className="size-5" />}
          ariaLabel={translate('components.desktopHome.composer.selectAgent', '选择智能体')}
          onChange={(value) => onAgentChange(value as TuiAgent)}
          className="desktop-home-context-trigger"
        />
        <InlineDropdown
          value={permissionMode}
          options={permissionOptions}
          icon={<ShieldCheck className="size-5" />}
          ariaLabel={translate('components.desktopHome.composer.permission', '权限设置')}
          onChange={onPermissionChange}
          className="desktop-home-context-trigger"
        />
      </div>
    </div>
  )
}
