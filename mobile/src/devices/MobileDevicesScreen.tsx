import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { translate } from '../i18n/mobile-i18n'
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
  {
    id: 'all',
    get label() {
      return translate('agentHistory.panel.all', 'All')
    }
  },
  {
    id: 'connected',
    get label() {
      return translate('diagnostics.useTroubleshootDiagnostics.connected', 'Connected')
    }
  },
  {
    id: 'disconnected',
    get label() {
      return translate('auto.mobile.src.devices.MobileDevicesScreen.11c69e4028', 'Disconnected')
    }
  }
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
  const t = useMobileTranslation()

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
    ...(current.length
      ? [
          {
            title: t('auto.mobile.src.devices.MobileDevicesScreen.db861564ea', 'Current device'),
            data: current
          }
        ]
      : []),
    ...(others.length
      ? [
          {
            title: t('auto.mobile.src.devices.MobileDevicesScreen.2c80480376', 'Other devices'),
            data: others
          }
        ]
      : [])
  ]
  return (
    <View style={[styles.container, { maxWidth: props.contentMaxWidth }]}>
      <View style={[styles.heading, compact && styles.headingCompact]}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
          {t('auto.mobile.src.devices.MobileDevicesScreen.de00883408', 'Device management')}
        </Text>
        <PairingActionButton
          label={t('auto.mobile.src.devices.MobileDevicesScreen.8bf6def55a', 'Add device')}
          labelStyle={styles.addLabel}
          icon={Plus}
          variant="ghost"
          onPress={props.onAdd}
          style={styles.newSession}
        />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
        {t(
          'auto.mobile.src.devices.MobileDevicesScreen.054e11f206',
          'Connect to a computer with a QR code, pairing code, or HiveCloud account'
        )}
      </Text>
      <View accessibilityRole="tablist" style={[styles.filters, styles.filterBar]}>
        {FILTERS.map((item) => {
          const count = filterMobileDevices(props.devices, item.id).length
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityLabel={t(
                'auto.mobile.src.devices.MobileDevicesScreen.ad2b127a73',
                '{{value0}}, devices: {{value1}}',
                { value0: item.label, value1: count }
              )}
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
                ? t('auto.mobile.src.devices.MobileDevicesScreen.5e450e7748', 'Reading devices')
                : props.error && !props.devices.length
                  ? t(
                      'auto.mobile.src.devices.MobileDevicesScreen.9660654f17',
                      'Could not read devices'
                    )
                  : props.devices.length
                    ? t(
                        'auto.mobile.src.devices.MobileDevicesScreen.665c1dc012',
                        'No matching devices'
                      )
                    : t('auto.mobile.src.devices.MobileDevicesScreen.bcf81b3336', 'No devices yet')}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.emptyBody}>
              {props.devices.length
                ? t(
                    'auto.mobile.src.devices.MobileDevicesScreen.f363578cda',
                    'Change the filter to see other devices'
                  )
                : t(
                    'auto.mobile.src.devices.MobileDevicesScreen.d8a7a0ef39',
                    'Add a computer to manage its connection here'
                  )}
            </Text>
            {props.error ? (
              <PairingActionButton
                label={t(
                  'auto.mobile.src.devices.MobileDevicesScreen.e72ed52915',
                  'Retry reading devices'
                )}
                variant="ghost"
                onPress={props.onRefresh}
                style={styles.textAction}
              />
            ) : null}
          </View>
        }
        ListFooterComponent={
          <PairingActionButton
            label={t('auto.mobile.src.devices.MobileDevicesScreen.c25a51d18c', 'Connection help')}
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
