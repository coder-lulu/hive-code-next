import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Monitor, ScanLine, X } from 'lucide-react-native'
import { RuntimeGroup } from './MobileRuntimeSelectorGroup'
import { BottomDrawer } from '../components/BottomDrawer'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { hostCatalogTargetsMatch } from './host-catalog-target-match'
import type { MobileTheme } from '../theme/mobile-theme'
import { createMobileRuntimeSelectorStyles as createStyles } from './mobile-runtime-selector-styles'
import { useEnsureHostConnected } from '../transport/client-context'
import type { HostCatalogEntry } from '../transport/types'
import {
  projectRuntimeSelectorEntries,
  type RuntimeSelectorConnectionStates,
  type RuntimeSelectorEntry
} from './runtime-selector-presentation'

type PendingAction =
  | { type: 'select'; host: HostCatalogEntry; selectedId: string | null }
  | { type: 'delete'; host: HostCatalogEntry }
  | { type: 'pair' }
  | { type: 'claim' }
  | null

export function MobileRuntimeSelector(props: {
  readonly catalog: readonly HostCatalogEntry[]
  readonly accountOnly?: boolean
  readonly connectionStates: RuntimeSelectorConnectionStates
  readonly onClose: () => void
  readonly onPair: () => void
  readonly onClaim?: () => void
  readonly onSelect: (runtimeId: string) => void
  readonly selectedId: string | null
  readonly theme: MobileTheme
  readonly visible: boolean
}) {
  const router = useRouter()
  const styles = useMemo(() => createStyles(props.theme), [props.theme])
  const { session } = useMobileAuthSession()
  const sessionScope = session ? `${session.authorityId}:${session.account.accountId}` : null
  const current = useRef({ props, sessionScope, scopeRevision: 0 })
  const scopeRevision =
    current.current.scopeRevision + Number(current.current.sessionScope !== sessionScope)
  current.current = { props, sessionScope, scopeRevision }
  const active = useRef(true)
  const ensureHostConnected = useEnsureHostConnected()
  const pendingActionRef = useRef<{
    action: Exclude<PendingAction, null>
    scopeRevision: number
  } | null>(null)
  const selectionRequestRef = useRef(0)
  const [pendingRuntimeId, setPendingRuntimeId] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const entries = useMemo(
    () =>
      projectRuntimeSelectorEntries(
        props.accountOnly
          ? props.catalog.filter((host) => host.accessSources?.includes('account-claimed'))
          : props.catalog,
        props.connectionStates,
        props.selectedId
      ),
    [props.catalog, props.accountOnly, props.connectionStates, props.selectedId]
  )
  const accountEntries = entries.filter((entry) => entry.group === 'account')
  const localEntries = entries.filter((entry) => entry.group === 'local')

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    setPendingRuntimeId(null)
    setSelectionError(null)
    if (!props.visible) {
      selectionRequestRef.current += 1
    }
    return () => {
      selectionRequestRef.current += 1
    }
  }, [props.visible, sessionScope])

  useEffect(() => {
    const action = pendingActionRef.current?.action
    if (
      action?.type === 'delete' &&
      !hostCatalogTargetsMatch(
        action.host,
        props.catalog.find((host) => host.id === action.host.id)
      )
    ) {
      pendingActionRef.current = null
    }
  }, [props.catalog])

  function closeWithAction(action: Exclude<PendingAction, null>) {
    if (!active.current || current.current.scopeRevision !== scopeRevision) {
      return
    }
    pendingActionRef.current = { action, scopeRevision }
    current.current.props.onClose()
  }

  function deleteRuntime(entry: RuntimeSelectorEntry) {
    const host = props.catalog.find((runtime) => runtime.id === entry.id)
    const latest = current.current.props.catalog.find((runtime) => runtime.id === entry.id)
    if (
      !current.current.props.visible ||
      !sessionScope ||
      !host?.runtimeRecordId ||
      !hostCatalogTargetsMatch(host, latest) ||
      !host.accessSources?.includes('account-claimed')
    ) {
      return
    }
    selectionRequestRef.current += 1
    closeWithAction({ type: 'delete', host })
  }

  function dismiss() {
    if (!active.current || current.current.scopeRevision !== scopeRevision) {
      return
    }
    selectionRequestRef.current += 1
    pendingActionRef.current = null
    setPendingRuntimeId(null)
    setSelectionError(null)
    current.current.props.onClose()
  }

  async function selectRuntime(entry: RuntimeSelectorEntry): Promise<void> {
    if (
      !active.current ||
      !current.current.props.visible ||
      current.current.scopeRevision !== scopeRevision ||
      pendingRuntimeId ||
      !entry.selectable
    ) {
      return
    }
    const host = current.current.props.catalog.find((runtime) => runtime.id === entry.id)
    if (!host?.profile || host.credentialStatus !== 'ready') {
      return
    }
    const selection = { type: 'select' as const, host, selectedId: props.selectedId }
    if (current.current.props.connectionStates[entry.id] === 'connected') {
      closeWithAction(selection)
      return
    }

    const request = selectionRequestRef.current + 1
    selectionRequestRef.current = request
    setPendingRuntimeId(entry.id)
    setSelectionError(null)
    try {
      const connected = await ensureHostConnected(host.profile)
      if (
        !active.current ||
        selectionRequestRef.current !== request ||
        current.current.scopeRevision !== scopeRevision
      ) {
        return
      }
      setPendingRuntimeId(null)
      if (current.current.props.selectedId !== selection.selectedId) {
        return
      }
      if (!selectionIsCurrent(selection)) {
        setSelectionError('电脑信息已变化，请重新选择电脑。')
        return
      }
      if (connected) {
        closeWithAction(selection)
      } else {
        setSelectionError(`${entry.name} 暂时无法连接，请重试或选择其他 Runtime。`)
      }
    } catch {
      if (
        active.current &&
        selectionRequestRef.current === request &&
        current.current.scopeRevision === scopeRevision &&
        current.current.props.selectedId === selection.selectedId
      ) {
        setPendingRuntimeId(null)
        setSelectionError(`${entry.name} 暂时无法连接，请重试或选择其他 Runtime。`)
      }
    }
  }

  function completePendingAction() {
    const pending = pendingActionRef.current
    pendingActionRef.current = null
    if (!active.current || !pending || pending.scopeRevision !== current.current.scopeRevision) {
      return
    }
    const { action } = pending
    if (action?.type === 'select') {
      if (current.current.props.selectedId !== action.selectedId) {
        return
      }
      if (!selectionIsCurrent(action)) {
        Alert.alert('电脑信息已变化', '请重新选择电脑，当前电脑选择保持不变。')
        return
      }
      current.current.props.onSelect(action.host.id)
    } else if (action?.type === 'delete') {
      const host = current.current.props.catalog.find((runtime) => runtime.id === action.host.id)
      if (
        current.current.sessionScope &&
        hostCatalogTargetsMatch(action.host, host) &&
        host?.runtimeRecordId &&
        host.accessSources?.includes('account-claimed')
      ) {
        router.push({
          pathname: '/runtime-delete',
          params: { runtimeRecordId: host.runtimeRecordId }
        })
      }
    } else if (action?.type === 'pair') {
      current.current.props.onPair()
    } else if (action?.type === 'claim') {
      current.current.props.onClaim?.()
    }
  }

  function selectionIsCurrent(action: Extract<PendingAction, { type: 'select' }>) {
    const latest = current.current.props
    const host = latest.catalog.find((runtime) => runtime.id === action.host.id)
    return (
      hostCatalogTargetsMatch(action.host, host) &&
      (!latest.accountOnly || host?.accessSources?.includes('account-claimed'))
    )
  }

  return (
    <BottomDrawer visible={props.visible} onAfterClose={completePendingAction} onClose={dismiss}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>
            选择电脑
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.description}>
            {props.accountOnly ? '连接账号中已认领的电脑' : '任务仅在你选择的电脑上运行'}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="关闭 Runtime 选择器"
          accessibilityRole="button"
          onPress={dismiss}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <X color={props.theme.color.text.secondary} size={24} strokeWidth={1.9} />
        </Pressable>
      </View>

      {entries.length === 0 ? (
        <View style={styles.emptyState}>
          <Monitor color={props.theme.color.text.tertiary} size={24} strokeWidth={2} />
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
            {props.accountOnly ? '还没有已认领的电脑' : '还没有可用的电脑'}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyDescription}>
            {props.accountOnly
              ? '在电脑端登录同一账号并发起认领。'
              : '连接电脑后，工作区与任务状态会在这里显示。'}
          </Text>
        </View>
      ) : (
        <>
          <RuntimeGroup
            entries={accountEntries}
            label="账号电脑"
            onDelete={deleteRuntime}
            deletableIds={
              sessionScope
                ? props.catalog
                    .filter(
                      (host) =>
                        host.runtimeRecordId && host.accessSources?.includes('account-claimed')
                    )
                    .map((host) => host.id)
                : []
            }
            onSelect={(entry) => void selectRuntime(entry)}
            pendingRuntimeId={pendingRuntimeId}
            styles={styles}
            theme={props.theme}
          />
          <RuntimeGroup
            entries={localEntries}
            label="本地配对"
            onSelect={(entry) => void selectRuntime(entry)}
            pendingRuntimeId={pendingRuntimeId}
            styles={styles}
            theme={props.theme}
          />
        </>
      )}

      {selectionError ? (
        <Text accessibilityLiveRegion="polite" style={styles.selectionError}>
          {selectionError}
        </Text>
      ) : null}

      {!props.accountOnly || (entries.length === 0 && props.onClaim) ? (
        <Pressable
          accessibilityLabel={props.accountOnly ? '认领电脑' : '配对新设备'}
          accessibilityRole="button"
          accessibilityState={{ disabled: pendingRuntimeId != null }}
          disabled={pendingRuntimeId != null}
          onPress={() => closeWithAction({ type: props.accountOnly ? 'claim' : 'pair' })}
          style={({ pressed }) => [
            styles.pairButton,
            pendingRuntimeId != null && styles.disabled,
            pressed && styles.pressed
          ]}
        >
          <ScanLine color={props.theme.color.text.primary} size={20} strokeWidth={2} />
          <Text maxFontSizeMultiplier={1.3} style={styles.pairButtonText}>
            {props.accountOnly ? '认领电脑' : '配对新设备'}
          </Text>
        </Pressable>
      ) : null}
    </BottomDrawer>
  )
}
