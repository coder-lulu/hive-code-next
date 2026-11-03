import { translate } from '../i18n/mobile-i18n'
import type { PickerOption } from '../components/PickerModal'
import type { MobileGroupMode, MobileSortMode } from './workspace-view-settings'

// Why: the host may be headless, so the note can't promise a desktop sidebar.
export const WORKSPACE_VIEW_SHARED_NOTE = '在你的设备间同步'

export const WORKSPACE_SORT_OPTIONS: PickerOption<MobileSortMode>[] = [
  // Why: desktop and persisted state keep the `smart` key, while mobile shows the product label.
  {
    value: 'smart',
    get label() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.0220c03c22',
        'Agent activity'
      )
    },
    get subtitle() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.99a8d6128a',
        'Show agents needing attention first, then sort by recent activity'
      )
    }
  },
  {
    value: 'name',
    get label() {
      return translate('host.edit.name', 'Name')
    },
    get subtitle() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.2ab9069aac',
        'Sort by name'
      )
    }
  },
  {
    value: 'recent',
    get label() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.cc1c1d4509',
        'Recent activity'
      )
    },
    get subtitle() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.f33c2220ef',
        'Latest output first'
      )
    }
  },
  {
    value: 'repo',
    get label() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.3b36f18ae0',
        'Repository'
      )
    },
    get subtitle() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.40be689c1d',
        'Sort by repository, then workspace name'
      )
    }
  },
  {
    value: 'manual',
    get label() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.a3c88fc206',
        'Manual'
      )
    },
    get subtitle() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.6d9db46eb7',
        'Keep the order arranged on the computer'
      )
    }
  }
]

export const WORKSPACE_GROUP_OPTIONS: PickerOption<MobileGroupMode>[] = [
  {
    value: 'none',
    get label() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.ce87911514',
        'No grouping'
      )
    }
  },
  {
    value: 'workspace-status',
    get label() {
      return translate('hostScreen.workspaceOptionControls.status', 'Status')
    }
  },
  {
    value: 'repo',
    get label() {
      return translate('agentHistory.panel.project', 'Project')
    }
  },
  {
    value: 'pr-status',
    get label() {
      return translate(
        'auto.mobile.src.worktree.workspace.list.picker.options.874551dd85',
        'PR status'
      )
    }
  }
]
