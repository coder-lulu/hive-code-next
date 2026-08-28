import { Bot, ChevronDown, FolderGit2, Mic, Paperclip, Plus, Send, ShieldCheck } from 'lucide-react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { DesktopHomeModel } from './desktop-home-model'

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
  return (
    <div className="desktop-home-composer-footer">
      <div className="desktop-home-composer-leading">
        <button
          type="button"
          className="desktop-home-composer-icon"
          aria-label="添加上下文"
          title="添加上下文"
        >
          <Plus className="size-4" />
        </button>
        <div className="desktop-home-selects">
          <label>
            <FolderGit2 className="size-3.5" />
            <select
              value={selectedWorkspaceId}
              onChange={(event) => onWorkspaceChange(event.target.value)}
              aria-label="选择工作区"
            >
              {model.recentWorkspaces.length === 0 ? <option value="">创建新工作区</option> : null}
              {model.recentWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.repoName} / {workspace.name}
                </option>
              ))}
            </select>
            <ChevronDown className="size-3" />
          </label>
          <label>
            <Bot className="size-3.5" />
            <select
              value={agent}
              onChange={(event) => onAgentChange(event.target.value as TuiAgent)}
              aria-label="选择 Agent"
            >
              {enabledAgents.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <ChevronDown className="size-3" />
          </label>
          <label>
            <ShieldCheck className="size-3.5" />
            <select
              value={permissionMode}
              onChange={(event) => onPermissionChange(event.target.value)}
              aria-label="权限设置"
            >
              <option value="default">默认权限</option>
              <option value="ask">始终询问</option>
              <option value="auto">自动批准</option>
            </select>
            <ChevronDown className="size-3" />
          </label>
        </div>
      </div>
      <div className="desktop-home-composer-actions">
        <button type="button" className="desktop-home-composer-icon" aria-label="添加附件" title="添加附件">
          <Paperclip className="size-4" />
        </button>
        <button type="button" className="desktop-home-composer-icon" aria-label="语音输入" title="语音输入">
          <Mic className="size-4" />
        </button>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">⌘ Enter</span>
        <button
          type="button"
          className="desktop-home-send"
          disabled={!hasDraft}
          onClick={onSubmit}
          aria-label="发送任务"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  )
}
