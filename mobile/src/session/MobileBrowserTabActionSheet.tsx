import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react-native'
import type { MobileSessionTab } from './mobile-session-route-types'
import { ActionSheetModal, type ActionSheetAction } from '../components/ActionSheetModal'
import { getMobileSessionTabTitle } from './mobile-terminal-tab-agent'

type BrowserTab = Extract<MobileSessionTab, { type: 'browser' }>
export type MobileBrowserNavigationMethod = 'browser.back' | 'browser.forward' | 'browser.reload'

/** Keeps browser-tab navigation actions out of the session route while preserving
 *  the target captured at the moment each drawer action is pressed. */
export function MobileBrowserTabActionSheet(props: {
  target: BrowserTab | null
  onClose: () => void
  onNavigate: (target: BrowserTab, method: MobileBrowserNavigationMethod) => void
  onCloseTab: (target: BrowserTab) => void
  /** Rendered after Close — receives the open tab's id so the session route's
   *  bulk-close builder can resolve the anchor itself. */
  bulkCloseActions?: (anchorTabId: string | undefined, dismiss: () => void) => ActionSheetAction[]
}): React.JSX.Element {
  const { target, onClose, onNavigate, onCloseTab, bulkCloseActions } = props
  return (
    <ActionSheetModal
      visible={target != null}
      title={getBrowserActionSheetTitle(target)}
      actions={[
        ...(target?.canGoBack
          ? [
              {
                label: '后退',
                icon: ChevronLeft,
                onPress: () => {
                  const current = target
                  onClose()
                  if (current) {
                    onNavigate(current, 'browser.back')
                  }
                }
              }
            ]
          : []),
        ...(target?.canGoForward
          ? [
              {
                label: '前进',
                icon: ChevronRight,
                onPress: () => {
                  const current = target
                  onClose()
                  if (current) {
                    onNavigate(current, 'browser.forward')
                  }
                }
              }
            ]
          : []),
        {
          label: '重新加载',
          icon: RefreshCw,
          onPress: () => {
            const current = target
            onClose()
            if (current) {
              onNavigate(current, 'browser.reload')
            }
          }
        },
        {
          label: '关闭',
          destructive: true,
          onPress: () => {
            const current = target
            onClose()
            if (current) {
              onCloseTab(current)
            }
          }
        },
        ...(bulkCloseActions?.(target?.id, onClose) ?? [])
      ]}
      onClose={onClose}
    />
  )
}

function getBrowserActionSheetTitle(target: BrowserTab | null): string {
  if (!target) {
    return '浏览器'
  }
  const resolvedTitle = getMobileSessionTabTitle(target)
  if (target.title.trim() === resolvedTitle) {
    return resolvedTitle
  }
  return resolvedTitle === 'New Browser' ? '新建浏览器' : '浏览器'
}
