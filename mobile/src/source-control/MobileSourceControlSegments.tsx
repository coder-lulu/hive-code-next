import { Pressable, Text, View } from 'react-native'
import { SOURCE_CONTROL_HUB_TABS, type SourceControlHubTab } from './mobile-source-control-hub-tab'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileSourceControlHubStyles } from './mobile-source-control-hub-styles'

type Props = {
  active: SourceControlHubTab
  onSelect: (tab: SourceControlHubTab) => void
}

// The hub's top-level lens switcher. Switching is local state (no route push) so
// scroll position and the shared branch card persist across Changes/PR/History.
export function MobileSourceControlSegments({ active, onSelect }: Props) {
  const hubStyles = useMobileThemeStyles(createMobileSourceControlHubStyles)
  return (
    <View style={hubStyles.segments} accessibilityRole="tablist">
      {SOURCE_CONTROL_HUB_TABS.map((tab) => {
        const isActive = tab === active
        return (
          <Pressable
            key={tab}
            style={({ pressed }) => [
              hubStyles.segment,
              isActive && hubStyles.segmentActive,
              pressed && !isActive && hubStyles.segmentPressed
            ]}
            onPress={() => onSelect(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={SOURCE_CONTROL_TAB_LABELS[tab]}
          >
            <Text
              style={[hubStyles.segmentText, isActive && hubStyles.segmentTextActive]}
              numberOfLines={1}
            >
              {SOURCE_CONTROL_TAB_LABELS[tab]}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const SOURCE_CONTROL_TAB_LABELS: Record<SourceControlHubTab, string> = {
  changes: '更改',
  pr: '拉取请求',
  history: '提交记录'
}
