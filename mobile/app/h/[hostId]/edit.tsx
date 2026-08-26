import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import type { MobileTheme } from '../../../src/theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../../../src/theme/mobile-theme-provider'
import { loadHosts, updateHostNameAndEndpoint } from '../../../src/transport/host-store'
import { displayHostEndpoint } from '../../../src/transport/host-endpoint'
import { resolveHostEndpointEdit } from '../../../src/transport/host-endpoint-edit'
import { useForceReconnect, usePrimeHosts } from '../../../src/transport/client-context'
import type { HostProfile } from '../../../src/transport/types'

export default function EditHostScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const primeHosts = usePrimeHosts()
  const forceReconnectHost = useForceReconnect()

  const [host, setHost] = useState<HostProfile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Why: setSaving is async, so a second trigger before the re-render could
  // still read stale state and re-enter handleSave; the ref closes that race.
  const savingRef = useRef(false)

  const load = useCallback(async () => {
    if (!hostId) {
      setLoadError('Missing host.')
      return
    }
    try {
      const hosts = await loadHosts()
      const found = hosts.find((h) => h.id === hostId) ?? null
      if (!found) {
        setLoadError('This host was removed from this phone.')
        setHost(null)
        return
      }
      setHost(found)
      setName(found.name)
      setAddress(displayHostEndpoint(found.endpoint))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load host.')
      setHost(null)
    }
  }, [hostId])

  useEffect(() => {
    void load()
  }, [load])

  const endpointEdit = useMemo(
    () => (host ? resolveHostEndpointEdit(host.endpoint, address) : null),
    [address, host]
  )

  const nameTrimmed = name.trim()
  const nameChanged = host != null && nameTrimmed.length > 0 && nameTrimmed !== host.name
  const endpointChanged = endpointEdit?.kind === 'changed'
  const canSave =
    host != null &&
    endpointEdit != null &&
    nameTrimmed.length > 0 &&
    endpointEdit.kind !== 'invalid' &&
    (nameChanged || endpointChanged) &&
    !saving

  async function handleSave() {
    if (!host || !hostId || !endpointEdit || savingRef.current) {
      return
    }
    const nextName = name.trim()
    if (!nextName) {
      setSaveError('Enter a name.')
      return
    }
    if (endpointEdit.kind === 'invalid') {
      setSaveError(endpointEdit.error)
      return
    }

    const willRename = nextName !== host.name
    const nextEndpoint = endpointEdit.kind === 'changed' ? endpointEdit.endpoint : undefined
    if (!willRename && nextEndpoint === undefined) {
      router.back()
      return
    }

    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      // Why: a single mutateStoredHosts pass so name + endpoint commit
      // atomically — a mid-save failure can never persist one without the
      // other, and a host removed mid-edit throws instead of no-oping.
      await updateHostNameAndEndpoint(host.id, {
        ...(willRename ? { name: nextName } : {}),
        ...(nextEndpoint !== undefined ? { endpoint: nextEndpoint } : {})
      })
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
      const hosts = await loadHosts()
      primeHosts(hosts)
    } catch {
      // best-effort re-prime; persisted data is unaffected
    }

    savingRef.current = false
    setSaving(false)
    router.back()

    if (nextEndpoint !== undefined) {
      // Why: reconnect is a follow-on side effect of a save that already
      // committed — its failure or a hang must not be reported as a save
      // failure or block navigating back.
      void forceReconnectHost(host.id).catch(() => {})
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
        <Text style={styles.heading}>编辑电脑</Text>
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
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
            <Text style={styles.secondaryButtonText}>Go back</Text>
          </Pressable>
        </View>
      ) : !host ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={theme.color.text.secondary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[
              styles.form,
              { paddingBottom: insets.bottom + theme.spacing.space24 }
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.help}>
              Change the display name or connection address. Address edits only switch where this
              phone connects — they do not re-pair. Use this when the same desktop is reachable at a
              different IP (for example home LAN vs Tailscale).
            </Text>

            <Text style={styles.label}>名称</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Name"
              value={name}
              onChangeText={(value) => {
                setName(value)
                setSaveError(null)
              }}
              placeholder="Host name"
              placeholderTextColor={theme.color.text.tertiary}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
            />

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
              Accepts IP, host:port, or ws:// / wss://. Missing port defaults to the current port
              (or 6768).
            </Text>

            {endpointEdit == null ? null : endpointEdit.kind !== 'invalid' ? (
              <Text style={styles.preview} numberOfLines={2}>
                Connects to {endpointEdit.endpoint}
              </Text>
            ) : address.trim().length > 0 ? (
              <Text style={styles.previewError}>{endpointEdit.error}</Text>
            ) : null}

            {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    flex: {
      flex: 1
    },
    topRow: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space20,
      gap: theme.spacing.space8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    heading: {
      ...theme.typography.pageTitle,
      flex: 1,
      color: theme.color.text.primary
    },
    saveButton: {
      minWidth: 64,
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space16,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected,
      alignItems: 'center',
      justifyContent: 'center'
    },
    saveButtonDisabled: {
      opacity: 0.4
    },
    saveButtonText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    form: {
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20,
      gap: theme.spacing.space8
    },
    help: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      marginBottom: theme.spacing.space8
    },
    label: {
      ...theme.typography.label,
      color: theme.color.text.secondary,
      fontWeight: '500',
      marginTop: theme.spacing.space12
    },
    input: {
      minHeight: theme.size.minimumTouchTarget,
      backgroundColor: theme.color.bg.surface,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      color: theme.color.text.primary,
      ...theme.typography.body,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: Platform.OS === 'ios' ? 12 : 10
    },
    hint: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary
    },
    preview: {
      ...theme.typography.code,
      marginTop: theme.spacing.space8,
      color: theme.color.text.secondary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : theme.typography.code.fontFamily
    },
    previewError: {
      ...theme.typography.body,
      marginTop: theme.spacing.space8,
      color: theme.color.status.danger
    },
    errorText: {
      ...theme.typography.body,
      color: theme.color.status.danger,
      marginTop: theme.spacing.space12
    },
    errorState: {
      flex: 1,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space24,
      gap: theme.spacing.space12
    },
    loadingState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center'
    },
    secondaryButton: {
      alignSelf: 'flex-start',
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    secondaryButtonText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '500'
    }
  })
}
