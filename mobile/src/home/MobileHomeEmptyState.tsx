import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { ChevronRight, QrCode, UserRound } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { MobileSegmentedControl } from '../components/ui/MobileSegmentedControl'
import { useAccountRuntimeDirectory } from '../runtime-directory/account-runtime-directory-provider'
import {
  projectRuntimeSelectorEntries,
  type RuntimeSelectorConnectionStates
} from '../runtime-directory/runtime-selector-presentation'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { HostCatalogEntry } from '../transport/types'
import { MobileHomeAccountComputers } from './MobileHomeAccountComputers'
import {
  mobileHomeConnectionContent,
  type MobileHomeConnectionMethod
} from './mobile-home-connection-content'
import { createMobileHomeConnectionStyles } from './mobile-home-connection-styles'

export function MobileHomeEmptyState(props: {
  bottomInset: number
  contentMaxWidth: number
  isWideLayout: boolean
  method: MobileHomeConnectionMethod
  onMethodChange: (method: MobileHomeConnectionMethod) => void
  onPairDesktop: () => void
  onSelectComputer: () => void
  onOpenComputer: (host: HostCatalogEntry) => void
  accountComputers: readonly HostCatalogEntry[]
  connectionStates: RuntimeSelectorConnectionStates
  selectedId: string | null
}) {
  const router = useRouter()
  const { hydrated, session } = useMobileAuthSession()
  const { state, refresh } = useAccountRuntimeDirectory()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileHomeConnectionStyles)
  const isAccount = props.method === 'account'
  const content = mobileHomeConnectionContent[props.method]
  const entries = useMemo(
    () =>
      projectRuntimeSelectorEntries(
        props.accountComputers,
        props.connectionStates,
        props.selectedId
      ),
    [props.accountComputers, props.connectionStates, props.selectedId]
  )
  const loading =
    state.status === 'loading' || state.status === 'refreshing' || state.status === 'idle'
  const emptyAccount = !!session && state.status === 'ready' && !state.error && entries.length === 0
  const directoryFailed = !!session && !!state.error && entries.length === 0
  const primaryLabel = !isAccount
    ? '扫描二维码'
    : !session
      ? '登录 HiveCloud'
      : emptyAccount
        ? '认领电脑'
        : directoryFailed
          ? '重新获取电脑'
          : '选择电脑'
  const primaryDisabled = isAccount && (!hydrated || (!!session && loading && entries.length === 0))
  const Icon = isAccount ? UserRound : QrCode
  function primaryAction() {
    if (primaryDisabled) {
      return
    }
    if (!isAccount) {
      props.onPairDesktop()
    } else if (!session) {
      router.push('/login')
    } else if (emptyAccount) {
      router.push('/claim-computer')
    } else if (directoryFailed) {
      void refresh()
    } else {
      props.onSelectComputer()
    }
  }
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: theme.spacing.space24 + props.bottomInset },
        props.isWideLayout && { maxWidth: props.contentMaxWidth }
      ]}
    >
      <MobileSegmentedControl
        accessibilityLabel="选择连接方式"
        selectionStyle="surface"
        value={props.method}
        onValueChange={props.onMethodChange}
        options={[
          {
            value: 'scan',
            label: '扫码连接',
            renderIcon: (selected) => (
              <QrCode
                size={20}
                strokeWidth={2}
                color={selected ? theme.color.text.primary : theme.color.text.secondary}
              />
            )
          },
          {
            value: 'account',
            label: '账号连接',
            renderIcon: (selected) => (
              <UserRound
                size={20}
                strokeWidth={2}
                color={selected ? theme.color.text.primary : theme.color.text.secondary}
              />
            )
          }
        ]}
      />
      <View style={styles.panel}>
        <View style={styles.iconTile}>
          <Icon size={24} strokeWidth={2} color={theme.color.text.secondary} />
        </View>
        <View style={styles.panelCopy}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.panelTitle}>
            {content.title}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
            {isAccount && session
              ? '选择账号下已认领的电脑，连接后继续工作。'
              : content.description}
          </Text>
        </View>
        <Pressable
          testID="home-connection-primary"
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          accessibilityState={{
            disabled: primaryDisabled,
            busy: isAccount && !!session && loading
          }}
          disabled={primaryDisabled}
          onPress={primaryAction}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
            primaryDisabled && styles.disabled
          ]}
        >
          <Icon size={20} strokeWidth={2} color={theme.color.text.inverse} />
          <Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>
            {primaryLabel}
          </Text>
        </Pressable>
        {isAccount && !hydrated ? (
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.hint}>
            正在读取账号…
          </Text>
        ) : null}
        {isAccount && session ? (
          <MobileHomeAccountComputers
            entries={entries}
            computers={props.accountComputers}
            loading={loading}
            error={state.error}
            empty={emptyAccount}
            onRefresh={() => void refresh()}
            onOpen={props.onOpenComputer}
          />
        ) : null}
      </View>
      <View style={styles.stepsSection}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.hint}>
          连接步骤
        </Text>
        {content.steps.map((step, index) => (
          <View key={step.title} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <Text maxFontSizeMultiplier={1.3} style={styles.stepNumText}>
                {String(index + 1).padStart(2, '0')}
              </Text>
            </View>
            <View style={styles.stepText}>
              <Text maxFontSizeMultiplier={1.3} style={styles.stepTitle}>
                {step.title}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
                {step.description}
              </Text>
            </View>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={content.help}
          onPress={() => (isAccount ? router.push('/claim-computer') : props.onPairDesktop())}
          style={({ pressed }) => [styles.help, pressed && styles.pressed]}
        >
          <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
            {content.help}
          </Text>
          <ChevronRight size={16} strokeWidth={2} color={theme.color.text.secondary} />
        </Pressable>
      </View>
    </ScrollView>
  )
}
