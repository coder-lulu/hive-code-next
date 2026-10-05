import type { PickerOption } from '../components/PickerModal'
import type { MobileGroupMode, MobileSortMode } from './workspace-view-settings'

// Why: the host may be headless, so the note can't promise a desktop sidebar.
export const WORKSPACE_VIEW_SHARED_NOTE = '在你的设备间同步'

export const WORKSPACE_SORT_OPTIONS: PickerOption<MobileSortMode>[] = [
  // Why: desktop and persisted state keep the `smart` key, while mobile shows the product label.
  {
    value: 'smart',
    label: 'Agent 活动',
    subtitle: '优先显示需要关注的 Agent，再按最近活动排序'
  },
  { value: 'name', label: '名称', subtitle: '按名称排序' },
  { value: 'recent', label: '最近活动', subtitle: '最新输出优先' },
  { value: 'repo', label: '代码仓库', subtitle: '先按仓库，再按工作区名称' },
  { value: 'manual', label: '手动', subtitle: '保持电脑端拖动顺序' }
]

export const WORKSPACE_GROUP_OPTIONS: PickerOption<MobileGroupMode>[] = [
  { value: 'none', label: '不分组' },
  { value: 'workspaceStatus', label: '状态' },
  { value: 'repo', label: '代码仓库' },
  { value: 'prStatus', label: 'PR 状态' }
]
