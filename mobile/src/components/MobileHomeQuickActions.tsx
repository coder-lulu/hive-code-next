import { useRef, useState } from 'react'
import { Plus, QrCode } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { HostProfile } from '../transport/types'
import { hostEndpointLabel } from '../transport/host-endpoint-label'
import type { MobileTheme } from '../theme/mobile-theme'
import { PickerModal } from './PickerModal'

type Props = {
  theme: MobileTheme
  connectedHosts: HostProfile[]
  onPairDesktop: () => void
  onCreateWorkspace: (hostId: string) => void
}

function hostPickerOptions(hosts: HostProfile[]) {
  const entries = hosts.map((host) => ({
    host,
    endpointLabel: hostEndpointLabel(host.endpoint)
  }))
  const endpointCounts = new Map<string, number>()
  for (const entry of entries) {
    const endpointKey = JSON.stringify([entry.host.name, entry.endpointLabel])
    endpointCounts.set(endpointKey, (endpointCounts.get(endpointKey) ?? 0) + 1)
  }
  return entries.map((entry) => {
    const endpointKey = JSON.stringify([entry.host.name, entry.endpointLabel])
    const endpointCollides = (endpointCounts.get(endpointKey) ?? 0) > 1
    const subtitle = endpointCollides
      ? `${entry.endpointLabel} · ${entry.host.id}`
      : entry.endpointLabel
    return { value: entry.host.id, label: entry.host.name, subtitle }
  })
}

export function MobileHomeQuickActions(props: Props) {
  const styles = createStyles(props.theme)
  const [hostPickerForHostSet, setHostPickerForHostSet] = useState<string | null>(null)
  const pendingHostIdRef = useRef<string | null>(null)
  const canCreateWorkspace = props.connectedHosts.length > 0
  const hostSetKey = JSON.stringify(props.connectedHosts.map((host) => host.id))
  const hostPickerVisible = hostPickerForHostSet === hostSetKey
  if (hostPickerForHostSet !== null && !hostPickerVisible) {
    setHostPickerForHostSet(null)
  }

  function handleCreateWorkspace() {
    if (props.connectedHosts.length === 1) {
      props.onCreateWorkspace(props.connectedHosts[0].id)
      return
    }
    if (props.connectedHosts.length > 1) {
      setHostPickerForHostSet(hostSetKey)
    }
  }

  function handleHostSelect(hostId: string) {
    pendingHostIdRef.current = hostId
    setHostPickerForHostSet(null)
  }

  function handleHostPickerClosed() {
    setHostPickerForHostSet(null)
    const hostId = pendingHostIdRef.current
    pendingHostIdRef.current = null
    if (hostId && props.connectedHosts.some((host) => host.id === hostId)) {
      props.onCreateWorkspace(hostId)
    }
  }

  return (
    <>
      <Text style={styles.sectionHeading}>快捷操作</Text>
      <View style={styles.quickActions}>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.quickAction, pressed && styles.quickActionPressed]}
          onPress={props.onPairDesktop}
        >
          <View style={styles.quickActionIcon}>
            <QrCode size={18} color={props.theme.color.text.secondary} />
          </View>
          <Text style={styles.quickActionLabel}>连接电脑</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canCreateWorkspace }}
          disabled={!canCreateWorkspace}
          style={({ pressed }) => [
            styles.quickAction,
            !canCreateWorkspace && styles.quickActionDisabled,
            pressed && styles.quickActionPressed
          ]}
          onPress={handleCreateWorkspace}
        >
          <View style={styles.quickActionIcon}>
            <Plus size={18} color={props.theme.color.text.secondary} />
          </View>
          <Text style={styles.quickActionLabel}>新建工作区</Text>
        </Pressable>
      </View>
      <PickerModal
        visible={hostPickerVisible}
        title="选择电脑"
        options={hostPickerOptions(props.connectedHosts)}
        selected=""
        onSelect={handleHostSelect}
        onClose={() => setHostPickerForHostSet(null)}
        onAfterClose={handleHostPickerClosed}
      />
    </>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    sectionHeading: {
      ...theme.typography.meta,
      marginTop: theme.spacing.space24,
      marginBottom: theme.spacing.space8,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    quickActions: { flexDirection: 'row', gap: theme.spacing.space8 },
    quickAction: {
      minHeight: 56,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    quickActionPressed: { backgroundColor: theme.color.bg.subtle },
    quickActionDisabled: { opacity: 0.45 },
    quickActionIcon: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    quickActionLabel: {
      ...theme.typography.caption,
      flex: 1,
      color: theme.color.text.secondary,
      fontWeight: '600'
    }
  })
}
