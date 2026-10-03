import { useMemo, useState } from 'react'
import { ChevronRight, CircleHelp, Plus } from 'lucide-react-native'
import { Pressable, SectionList, Text, View, useWindowDimensions } from 'react-native'
import { PairingActionButton } from '../components/pairing/PairingActionButton'
import type { MobileTheme } from '../theme/mobile-theme'
import type { MobileConnectionPath } from '../transport/stable-logical-rpc-client'
import type { HostCatalogEntry } from '../transport/types'
import { useNow } from '../hooks/use-now'
import { MobileDeviceListItem } from './MobileDeviceListItem'
import {
  filterMobileDevices,
  type MobileDevice,
  type MobileDeviceFilter
} from './mobile-devices-model'
import { createMobileDevicesStyles } from './mobile-devices-styles'

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'connected', label: '已连接' },
  { id: 'disconnected', label: '未连接' }
] as const

export function MobileDevicesScreen(props: {
  devices: readonly MobileDevice[]
  theme: MobileTheme
  contentMaxWidth: number
  paths: Readonly<Record<string, MobileConnectionPath>>
  pendingId: string | null
  loading: boolean
  error: string | null
  onAdd: () => void
  onHelp: () => void
  onRefresh: () => void
  onActions: (host: HostCatalogEntry) => void
  onDetails: (host: HostCatalogEntry) => void
  onRetry: (host: HostCatalogEntry) => void
}) {
  const styles = useMemo(() => createMobileDevicesStyles(props.theme), [props.theme])
  const { width, fontScale } = useWindowDimensions()
  const compact =
    Math.min(width, props.contentMaxWidth) / Math.min(fontScale, 1.3) <
    props.theme.size.compactLayoutBreakpoint
  const [filter, setFilter] = useState<MobileDeviceFilter>('all')
  const now = useNow()
  const filtered = filterMobileDevices(props.devices, filter)
  const current = filtered.filter((device) => device.current)
  const others = filtered.filter((device) => !device.current)
  const sections = [
    ...(current.length ? [{ title: '当前使用', data: current }] : []),
    ...(others.length ? [{ title: '其他设备', data: others }] : [])
  ]
  return (
    <View style={[styles.container, { maxWidth: props.contentMaxWidth }]}>
      <View style={[styles.heading, compact && styles.headingCompact]}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
          设备管理
        </Text>
        <PairingActionButton
          label="添加设备"
          labelStyle={styles.addLabel}
          icon={Plus}
          variant="ghost"
          onPress={props.onAdd}
          style={styles.newSession}
        />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
        扫码、配对码或 HiveCloud 账号连接电脑
      </Text>
      <View accessibilityRole="tablist" style={[styles.filters, styles.filterBar]}>
        {FILTERS.map((item) => {
          const count = filterMobileDevices(props.devices, item.id).length
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityLabel={`${item.label}，${count} 台设备`}
              accessibilityState={{ selected: filter === item.id }}
              onPress={() => setFilter(item.id)}
              style={({ pressed }) => [
                styles.filter,
                filter === item.id && styles.filterSelected,
                pressed && styles.pressed
              ]}
            >
              <Text
                maxFontSizeMultiplier={1.3}
                style={[styles.filterLabel, filter === item.id && styles.filterLabelSelected]}
              >
                {item.label} {count}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {props.error ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          {props.error}
        </Text>
      ) : null}
      <SectionList
        sections={sections}
        keyExtractor={(device) => device.host.id}
        stickySectionHeadersEnabled={false}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshing={props.loading}
        onRefresh={props.onRefresh}
        renderSectionHeader={({ section }) => (
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
            style={styles.sectionHeading}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item, index, section }) => (
          <MobileDeviceListItem
            device={item}
            theme={props.theme}
            compact={compact}
            first={index === 0}
            last={index === section.data.length - 1}
            now={now}
            path={props.paths[item.host.id]}
            pending={props.pendingId === item.host.id}
            onActions={() => props.onActions(item.host)}
            onDetails={() => props.onDetails(item.host)}
            onRetry={() => props.onRetry(item.host)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
              {props.loading
                ? '正在读取设备'
                : props.error && !props.devices.length
                  ? '设备读取失败'
                  : props.devices.length
                    ? '没有匹配的设备'
                    : '暂无设备'}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.emptyBody}>
              {props.devices.length ? '切换筛选查看其他设备' : '添加电脑后，在这里管理连接'}
            </Text>
            {props.error ? (
              <PairingActionButton
                label="重试读取设备"
                variant="ghost"
                onPress={props.onRefresh}
                style={styles.textAction}
              />
            ) : null}
          </View>
        }
        ListFooterComponent={
          <PairingActionButton
            label="连接帮助"
            labelStyle={styles.helpLabel}
            icon={CircleHelp}
            trailingIcon={ChevronRight}
            variant="ghost"
            onPress={props.onHelp}
            style={styles.help}
          />
        }
      />
    </View>
  )
}
