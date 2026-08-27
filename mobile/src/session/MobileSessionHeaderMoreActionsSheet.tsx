import { ListChecks } from 'lucide-react-native'
import { MobileAgentSessionHistoryIcon } from '../agent-history/MobileAgentSessionHistoryIcon'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { useMobileTheme } from '../theme/mobile-theme-provider'

type Props = {
  visible: boolean
  showAgentSessionHistory: boolean
  showChecks: boolean
  onOpenAgentSessionHistory: () => void
  onOpenChecks: () => void
  onClose: () => void
}

export function MobileSessionHeaderMoreActionsSheet({
  visible,
  showAgentSessionHistory,
  showChecks,
  onOpenAgentSessionHistory,
  onOpenChecks,
  onClose
}: Props) {
  const theme = useMobileTheme()

  return (
    <ActionSheetModal
      visible={visible}
      actions={[
        ...(showAgentSessionHistory
          ? [
              {
                label: 'Agent 会话历史',
                hint: '浏览并继续 Agent 会话',
                renderIcon: () => (
                  <MobileAgentSessionHistoryIcon
                    size={theme.spacing.space20}
                    color={theme.color.text.secondary}
                    strokeWidth={2}
                  />
                ),
                onPress: onOpenAgentSessionHistory
              }
            ]
          : []),
        ...(showChecks
          ? [
              {
                label: '检查',
                hint: '打开拉取请求检查',
                icon: ListChecks,
                onPress: onOpenChecks
              }
            ]
          : [])
      ]}
      onClose={onClose}
    />
  )
}
