import { Bot, ChevronDown, FolderGit2, Mic, Paperclip, Plus, Send, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { DesktopHomeModel } from './desktop-home-model'
import { translate } from '@/i18n/i18n'

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
  return (
    <div className="desktop-home-composer-footer">
      <div className="desktop-home-composer-leading">
        <button
          type="button"
          className="desktop-home-composer-icon"
          aria-label={translate('components.desktopHome.composer.addContext', 'Add context')}
          title={translate('components.desktopHome.composer.addContext', 'Add context')}
        >
          <Plus className="size-4" />
        </button>
        <div className="desktop-home-selects">
          <label>
            <FolderGit2 className="size-3.5" />
            <select
              value={selectedWorkspaceId}
              onChange={(event) => onWorkspaceChange(event.target.value)}
              aria-label={translate(
                'components.desktopHome.composer.selectWorkspace',
                'Select workspace'
              )}
            >
              {model.recentWorkspaces.length === 0 ? (
                <option value="">
                  {translate('components.desktopHome.newWorkspace', 'New workspace')}
                </option>
              ) : null}
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
              aria-label={translate('components.desktopHome.composer.selectAgent', 'Select agent')}
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
              aria-label={translate(
                'components.desktopHome.composer.permission',
                'Permission mode'
              )}
            >
              <option value="default">
                {translate('components.desktopHome.composer.permissionDefault', 'Default')}
              </option>
              <option value="ask">
                {translate('components.desktopHome.composer.permissionAsk', 'Always ask')}
              </option>
              <option value="auto">
                {translate('components.desktopHome.composer.permissionAuto', 'Auto-approve')}
              </option>
            </select>
            <ChevronDown className="size-3" />
          </label>
        </div>
      </div>
      <div className="desktop-home-composer-actions">
        <button
          type="button"
          className="desktop-home-composer-icon"
          aria-label={translate('components.desktopHome.composer.attach', 'Add attachment')}
          title={translate('components.desktopHome.composer.attach', 'Add attachment')}
        >
          <Paperclip className="size-4" />
        </button>
        <button
          type="button"
          className="desktop-home-composer-icon"
          aria-label={translate('components.desktopHome.composer.voice', 'Voice input')}
          title={translate('components.desktopHome.composer.voice', 'Voice input')}
        >
          <Mic className="size-4" />
        </button>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">⌘ Enter</span>
        <button
          type="button"
          className="desktop-home-send"
          disabled={!hasDraft}
          onClick={onSubmit}
          aria-label={translate('components.desktopHome.composer.send', 'Send task')}
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  )
}
