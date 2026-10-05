/* eslint-disable max-lines -- Why: the edit route keeps local-host and cloud-Runtime
   target fencing beside the form lifecycle that owns those transitions. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import {
  normalizeHiveRuntimeDisplayName,
  resolveHiveRuntimeDisplayName
} from '../../../../src/shared/hive-runtime-display-name'
import { useMobileTheme, useMobileThemeStyles } from '../../../src/theme/mobile-theme-provider'
import { createHostEditStyles } from '../../../src/host-edit-styles'
import { loadHosts, updateHostNameAndEndpoint } from '../../../src/transport/host-store'
import { displayHostEndpoint } from '../../../src/transport/host-endpoint'
import { resolveHostEndpointEdit } from '../../../src/transport/host-endpoint-edit'
import { usePrimeHosts, useRefreshHostClient } from '../../../src/transport/client-context'
import type { HostProfile } from '../../../src/transport/types'
import { useAccountRuntimeDirectory } from '../../../src/runtime-directory/account-runtime-directory-provider'
import type {
  AccountRuntimeDirectoryEntry,
  AccountRuntimeDirectoryScope
} from '../../../src/runtime-directory/account-runtime-directory-types'
import { hostOs } from '../../../src/platform/host-os'

export default function EditHostScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createHostEditStyles)
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const primeHosts = usePrimeHosts()
  const directory = useAccountRuntimeDirectory()
  const refreshHostClient = useRefreshHostClient()

  const [host, setHost] = useState<HostProfile | null>(null)
  const [cloudRuntime, setCloudRuntime] = useState<AccountRuntimeDirectoryEntry | null>(null)
  const [cloudRuntimeScope, setCloudRuntimeScope] = useState<AccountRuntimeDirectoryScope | null>(
    null
  )
  const [targetLoaded, setTargetLoaded] = useState(false)
  const [initialName, setInitialName] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Why: setSaving is async, so a second trigger before the re-render could
  // still read stale state and re-enter handleSave; the ref closes that race.
  const savingRef = useRef(false)
  const loadedTargetKeyRef = useRef<string | null>(null)
  const nameEditedRef = useRef(false)

  const hintedRuntimeRecordId = host?.runtimeRecordId ?? hostId
  const directoryTarget = directory.state.entries.find(
    (entry) => entry.runtimeRecordId === hintedRuntimeRecordId
  )
  const directoryScopeKey = directory.state.scope
    ? `${directory.state.scope.authorityId}\u0000${directory.state.scope.accountId}`
    : 'local'
  const directoryTargetKey = directoryTarget
    ? `${directoryTarget.runtimeRecordId}\u0000${directoryTarget.resourceVersion}\u0000${directoryTarget.cloudDisplayNameVersion ?? 0}\u0000${directory.pendingDisplayNames.has(directoryTarget.runtimeRecordId) ? String(directory.pendingDisplayNames.get(directoryTarget.runtimeRecordId)) : ''}`
    : directory.state.status
  const loadTargetKey = `${hostId ?? ''}\u0000${directoryScopeKey}\u0000${host?.runtimeRecordId ?? ''}\u0000${directoryTargetKey}`

  const load = useCallback(async () => {
    if (!hostId) {
      setLoadError('Missing host.')
      return
    }
    if (loadedTargetKeyRef.current === loadTargetKey) {
      return
    }
    loadedTargetKeyRef.current = loadTargetKey
    setTargetLoaded(false)
    setCloudRuntime(null)
    setCloudRuntimeScope(null)
    try {
      const hosts = await loadHosts()
      if (loadedTargetKeyRef.current !== loadTargetKey) {
        return
      }
      const found = hosts.find((h) => h.id === hostId) ?? null
      const runtime = found?.runtimeRecordId
        ? (directory.state.entries.find(
            (entry) => entry.runtimeRecordId === found.runtimeRecordId
          ) ?? null)
        : (directory.state.entries.find((entry) => entry.runtimeRecordId === hostId) ?? null)
      const directoryPending = ['loading', 'refreshing'].includes(directory.state.status)
      if (
        (!found && !runtime && directoryPending) ||
        (found?.runtimeRecordId != null && !runtime && directoryPending)
      ) {
        loadedTargetKeyRef.current = null
        return
      }
      if (!found && !runtime) {
        setLoadError('This host was removed from this phone.')
        setHost(null)
        setCloudRuntime(null)
        setCloudRuntimeScope(null)
        setTargetLoaded(false)
        return
      }
      const displayName = runtime
        ? resolveHiveRuntimeDisplayName({
            cloudDisplayName: directory.pendingDisplayNames.has(runtime.runtimeRecordId)
              ? directory.pendingDisplayNames.get(runtime.runtimeRecordId)
              : runtime.cloudDisplayName,
            reportedDeviceName: runtime.deviceName,
            runtimeRecordId: runtime.runtimeRecordId
          })
        : found!.name
      const resolvedTargetKey = runtime
        ? `${runtime.runtimeRecordId}\u0000${runtime.resourceVersion}\u0000${runtime.cloudDisplayNameVersion ?? 0}\u0000${directory.pendingDisplayNames.has(runtime.runtimeRecordId) ? String(directory.pendingDisplayNames.get(runtime.runtimeRecordId)) : ''}`
        : directory.state.status
      loadedTargetKeyRef.current = `${hostId}\u0000${directoryScopeKey}\u0000${found?.runtimeRecordId ?? ''}\u0000${resolvedTargetKey}`
      setHost(found)
      setCloudRuntime(runtime)
      setCloudRuntimeScope(runtime ? directory.state.scope : null)
      setName(displayName)
      setInitialName(displayName)
      nameEditedRef.current = false
      setAddress(found ? displayHostEndpoint(found.endpoint) : '')
      setTargetLoaded(true)
      setLoadError(null)
    } catch (err) {
      if (loadedTargetKeyRef.current !== loadTargetKey) {
        return
      }
      setLoadError(err instanceof Error ? err.message : 'Failed to load host.')
      setHost(null)
      setCloudRuntime(null)
      setCloudRuntimeScope(null)
      setTargetLoaded(false)
    }
  }, [
    directory.pendingDisplayNames,
    directory.state.entries,
    directory.state.scope,
    directory.state.status,
    directoryScopeKey,
    hostId,
    loadTargetKey
  ])

  useEffect(() => {
    void load()
  }, [load])

  const endpointEdit = useMemo(
    () => (host ? resolveHostEndpointEdit(host.endpoint, address) : null),
    [address, host]
  )

  const normalizedName = useMemo(() => {
    try {
      return { value: normalizeHiveRuntimeDisplayName(name), error: null }
    } catch {
      return { value: null, error: '名称需为 1–128 个字符，且不能包含控制字符。' }
    }
  }, [name])
  const normalizedInitialName = useMemo(() => {
    try {
      return normalizeHiveRuntimeDisplayName(initialName)
    } catch {
      return initialName
    }
  }, [initialName])
  const nameChanged =
    nameEditedRef.current &&
    normalizedName.value != null &&
    normalizedName.value !== normalizedInitialName
  const endpointChanged = endpointEdit?.kind === 'changed'
  const canSave =
    targetLoaded &&
    (host == null || (endpointEdit != null && endpointEdit.kind !== 'invalid')) &&
    normalizedName.value != null &&
    (host != null || cloudRuntime?.cloudDisplayNameVersion != null) &&
    (nameChanged || endpointChanged) &&
    !saving

  async function handleSave() {
    if (!targetLoaded || !hostId || savingRef.current) {
      return
    }
    const nextName = normalizedName.value
    if (!nextName) {
      setSaveError(normalizedName.error ?? 'Enter a name.')
      return
    }
    if (host && endpointEdit?.kind === 'invalid') {
      setSaveError(endpointEdit.error)
      return
    }

    const willRename = nameChanged
    const nextEndpoint = endpointEdit?.kind === 'changed' ? endpointEdit.endpoint : undefined
    if (!willRename && nextEndpoint === undefined) {
      router.back()
      return
    }

    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    let cloudQueueFailed = false
    try {
      // Why: a single mutateStoredHosts pass so name + endpoint commit
      // atomically — a mid-save failure can never persist one without the
      // other, and a host removed mid-edit throws instead of no-oping.
      if (host) {
        await updateHostNameAndEndpoint(host.id, {
          ...(willRename ? { personalName: nextName } : {}),
          ...(nextEndpoint !== undefined ? { endpoint: nextEndpoint } : {})
        })
      }
      if (willRename && cloudRuntime?.cloudDisplayNameVersion != null) {
        try {
          if (!cloudRuntimeScope) {
            throw new Error('runtime_display_name_target_stale')
          }
          await directory.queueDisplayNameUpdate({
            runtimeRecordId: cloudRuntime.runtimeRecordId,
            desiredName: nextName,
            expectedScope: cloudRuntimeScope,
            expectedResourceVersion: cloudRuntime.resourceVersion,
            expectedCloudDisplayNameVersion: cloudRuntime.cloudDisplayNameVersion
          })
        } catch (error) {
          if (!host) {
            throw error
          }
          cloudQueueFailed = true
        }
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save host.')
      savingRef.current = false
      setSaving(false)
      return
    }

    try {
      // Why: the write already committed above; a re-prime failure here
      // must not be reported as a save failure — the next loadHosts() call
      // elsewhere in the app picks up the fresh state regardless.
      if (host) {
        const hosts = await loadHosts()
        primeHosts(hosts)
      }
    } catch {
      // best-effort re-prime; persisted data is unaffected
    }

    if (cloudQueueFailed) {
      setSaveError('名称已保存到本机，但无法排队 HiveCloud 同步。请稍后重试。')
      savingRef.current = false
      setSaving(false)
      return
    }

    savingRef.current = false
    setSaving(false)
    router.back()

    if (nextEndpoint !== undefined) {
      // The committed endpoint must replace both the primed profile and live client.
      if (host) {
        refreshHostClient(host.id)
      }
    }
  }

  async function handleClearCloudName() {
    if (
      !cloudRuntime ||
      !cloudRuntimeScope ||
      cloudRuntime.cloudDisplayNameVersion == null ||
      savingRef.current
    ) {
      return
    }
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      await directory.queueDisplayNameUpdate({
        runtimeRecordId: cloudRuntime.runtimeRecordId,
        desiredName: null,
        expectedScope: cloudRuntimeScope,
        expectedResourceVersion: cloudRuntime.resourceVersion,
        expectedCloudDisplayNameVersion: cloudRuntime.cloudDisplayNameVersion
      })
      const fallbackName = resolveHiveRuntimeDisplayName({
        cloudDisplayName: null,
        reportedDeviceName: cloudRuntime.deviceName,
        runtimeRecordId: cloudRuntime.runtimeRecordId
      })
      setName(fallbackName)
      setInitialName(fallbackName)
      nameEditedRef.current = false
      savingRef.current = false
      setSaving(false)
      router.back()
    } catch {
      setSaveError('无法排队清除 HiveCloud 名称。请稍后重试。')
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={theme.color.text.primary} />
        </Pressable>
        <Text maxFontSizeMultiplier={1.3} style={styles.heading}>
          {cloudRuntime ? '修改云端别名' : '编辑电脑'}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            (!canSave || pressed) && styles.saveButtonDisabled
          ]}
          onPress={() => void handleSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save host"
        >
          {saving ? (
            <ActivityIndicator size="small" color={theme.color.text.inverse} />
          ) : (
            <Text style={styles.saveButtonText}>保存</Text>
          )}
        </Pressable>
      </View>

      {loadError ? (
        <View style={styles.errorState}>
          <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {loadError}
          </Text>
          <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
            <Text style={styles.secondaryButtonText}>Go back</Text>
          </Pressable>
        </View>
      ) : !targetLoaded ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={theme.color.text.secondary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={hostOs() === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[
              styles.form,
              { paddingBottom: insets.bottom + theme.spacing.space24 }
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.help}>
              {host && host.runtimeRecordId && !cloudRuntime
                ? '当前 HiveCloud 目录不可用；此次名称只保存到本机，不会排队云同步。云端恢复后请再次编辑名称。地址仍只影响本地连接。'
                : host && cloudRuntime
                  ? '名称会立即保存到本机，并同步到当前 HiveCloud 账号。地址修改仅影响这台手机的本地连接，不会重新配对。'
                  : host
                    ? '名称和地址仅保存到这台手机，不会创建或更新 HiveCloud 名称。'
                    : '此 Runtime 来自当前 HiveCloud 账号。修改名称不会在这台手机上创建本地配对。'}
            </Text>

            <Text maxFontSizeMultiplier={1.3} style={styles.label}>
              {cloudRuntime ? '云端别名' : '名称'}
            </Text>
            <TextInput
              style={styles.input}
              maxFontSizeMultiplier={1.3}
              accessibilityLabel="Name"
              value={name}
              onChangeText={(value) => {
                nameEditedRef.current = true
                setName(value)
                setSaveError(null)
              }}
              placeholder={host?.lastKnownMachineName ?? 'Host name'}
              placeholderTextColor={theme.color.text.tertiary}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
            />

            {nameEditedRef.current && normalizedName.error ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={styles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                {normalizedName.error}
              </Text>
            ) : null}

            {cloudRuntime?.cloudDisplayNameVersion != null ? (
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  (saving || pressed) && styles.saveButtonDisabled
                ]}
                onPress={() => void handleClearCloudName()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Clear HiveCloud name"
              >
                <Text maxFontSizeMultiplier={1.3} style={styles.secondaryButtonText}>
                  清除云端别名
                </Text>
              </Pressable>
            ) : null}

            {host ? (
              <>
                <Text style={styles.label}>连接地址</Text>
                <TextInput
                  style={styles.input}
                  accessibilityLabel="Address"
                  value={address}
                  onChangeText={(value) => {
                    setAddress(value)
                    setSaveError(null)
                  }}
                  placeholder="192.168.1.10:6768"
                  placeholderTextColor={theme.color.text.tertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  keyboardType="url"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (canSave) {
                      void handleSave()
                    }
                  }}
                />
                <Text style={styles.hint}>
                  Accepts IP, host:port, or ws:// / wss://. Missing port defaults to the current
                  port (or 6768).
                </Text>

                {endpointEdit == null ? null : endpointEdit.kind !== 'invalid' ? (
                  <Text style={styles.preview} numberOfLines={2}>
                    Connects to {endpointEdit.endpoint}
                  </Text>
                ) : address.trim().length > 0 ? (
                  <Text style={styles.previewError}>{endpointEdit.error}</Text>
                ) : null}
              </>
            ) : cloudRuntime?.cloudDisplayNameVersion == null ? (
              <Text style={styles.hint}>HiveCloud 暂未开放此 Runtime 的名称编辑。</Text>
            ) : null}

            {saveError ? (
              <Text
                style={styles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
              >
                {saveError}
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  )
}
