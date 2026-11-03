import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { z } from 'zod'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { PairingActionButton } from '../components/pairing/PairingActionButton'
import { MobileIconButton } from '../components/ui/MobileIconButton'
import { MobileScreenHeader } from '../components/ui/MobileScreenHeader'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { hostOs } from '../platform/host-os'
import { useKeyboardOcclusion } from '../platform/keyboard-occlusion'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileRuntimeClaimStyles } from './mobile-runtime-claim-styles'
import { runtimeDeleteConfirmationName } from './mobile-runtime-delete-state'
import { useMobileRuntimeDelete } from './use-mobile-runtime-delete'

const RuntimeIdSchema = z.uuid().refine((value) => value === value.toLowerCase())

export function MobileRuntimeDeleteScreen() {
  const t = useMobileTranslation()

  const router = useRouter()
  const { runtimeRecordId } = useLocalSearchParams<{ runtimeRecordId?: string | string[] }>()
  const target = RuntimeIdSchema.safeParse(runtimeRecordId)
  const { hydrated, session } = useMobileAuthSession()
  const styles = useMobileThemeStyles(createMobileRuntimeClaimStyles)
  const { isWideLayout, contentMaxWidth } = useResponsiveLayout()
  const insets = useSafeAreaInsets()
  const keyboardHeight = useKeyboardOcclusion()
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.screen}>
      <MobileScreenHeader
        title={t(
          'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.84f877b018',
          'Delete Runtime'
        )}
        leading={
          <MobileIconButton
            accessibilityLabel={t('common.back', 'Back')}
            icon={ArrowLeft}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        }
      />
      <KeyboardAvoidingView
        behavior={hostOs() === 'ios' ? 'padding' : undefined}
        style={[
          styles.viewport,
          hostOs() === 'android' && { marginBottom: Math.max(0, keyboardHeight - insets.bottom) }
        ]}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.content, isWideLayout && { maxWidth: contentMaxWidth }]}
        >
          {!target.success ? (
            <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
              {t(
                'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.1f16553c0e',
                'Invalid Runtime ID. Return to the list and select it again.'
              )}
            </Text>
          ) : !hydrated ? (
            <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
              {t(
                'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.7b605810be',
                'Reading account…'
              )}
            </Text>
          ) : session ? (
            <SignedInDeleteForm
              key={`${session.authorityId}:${session.account.accountId}:${session.sessionExpiresAt}:${target.data}`}
              runtimeRecordId={target.data}
              session={session}
            />
          ) : (
            <>
              <Text maxFontSizeMultiplier={1.3} style={styles.body}>
                {t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.1b83b444cb',
                  'Sign in to the HiveCloud account that claimed this Runtime.'
                )}
              </Text>
              <PairingActionButton
                label={t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.c3c5f91052',
                  'Sign in to HiveCloud'
                )}
                onPress={() => router.push('/login')}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function SignedInDeleteForm({
  runtimeRecordId,
  session
}: {
  runtimeRecordId: string
  session: MobileSession
}) {
  const t = useMobileTranslation()

  const router = useRouter()
  const deletion = useMobileRuntimeDelete(runtimeRecordId, session)
  const styles = useMobileThemeStyles(createMobileRuntimeClaimStyles)
  const theme = useMobileTheme()
  const [focused, setFocused] = useState<'name' | 'sms' | null>(null)
  const unavailable = deletion.busy || deletion.loading || deletion.requiresLogin
  if (deletion.unsupported) {
    return (
      <Text maxFontSizeMultiplier={1.3} style={styles.body}>
        {t(
          'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.651e7ac7da',
          'Delete the Runtime and clear its connection records in the mobile app.'
        )}
      </Text>
    )
  }
  return (
    <View style={styles.form}>
      {deletion.completed ? (
        <>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.value}>
            {deletion.superseded
              ? t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.a0b78f20c3',
                  'This Runtime’s claim or deletion has changed. Your current connection is preserved. Return to the list for the latest status.'
                )
              : t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.f8d4b984be',
                  'The Runtime was unclaimed from the account and local connection records were cleared. Projects and sessions on the computer remain.'
                )}
          </Text>
          <PairingActionButton
            label={t('app.pairConfirm.backToHome', 'Back to home')}
            onPress={() => router.replace('/')}
          />
        </>
      ) : deletion.cloudConfirmed ? (
        <>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
            {t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.0cff92c209',
              'Unclaimed from the account. Clearing connection records on this phone. If cleanup fails, retry without verifying another SMS code.'
            )}
          </Text>
          <PairingActionButton
            label={t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.80167cf832',
              'Retry clearing local records'
            )}
            loading={deletion.busy}
            disabled={unavailable}
            onPress={() => void deletion.retryCleanup()}
          />
        </>
      ) : deletion.uncertain ? (
        <>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
            {t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.c5815852e6',
              'The deletion result cannot be confirmed right now. Check the Runtime’s status in your account before continuing.'
            )}
          </Text>
          <PairingActionButton
            label={t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.3ef28ad7bc',
              'Check deletion result'
            )}
            loading={deletion.busy}
            disabled={unavailable}
            onPress={() => void deletion.review()}
          />
        </>
      ) : deletion.loading ? (
        <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
          {t(
            'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.6776dc9e67',
            'Checking Runtime ownership…'
          )}
        </Text>
      ) : deletion.entry ? (
        <>
          <View style={styles.details}>
            <Text maxFontSizeMultiplier={1.3} style={styles.value}>
              {runtimeDeleteConfirmationName(deletion.entry)}
            </Text>
            <Text selectable maxFontSizeMultiplier={1.3} style={styles.hint}>
              {runtimeRecordId}
            </Text>
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.body}>
            {t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.ec15a7ec25',
              'Deleting will unclaim this Runtime from the account, revoke existing connection access, and clear all associated connection records on this phone. You can do this even when the computer is offline.'
            )}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.body}>
            {t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.9e76c31057',
              'Projects and sessions on the computer will remain. Claim or pair it again to use it later.'
            )}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>
            {t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.4c5c8107c5',
              'Enter the full name shown above to confirm'
            )}
          </Text>
          <TextInput
            accessibilityLabel={t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.3d7c55162a',
              'Confirm Runtime name'
            )}
            value={deletion.confirmationName}
            onChangeText={deletion.setConfirmationName}
            editable={!unavailable}
            autoCapitalize="none"
            autoCorrect={false}
            maxFontSizeMultiplier={1.3}
            onFocus={() => setFocused('name')}
            onBlur={() => setFocused(null)}
            style={[styles.input, focused === 'name' && styles.focused]}
          />
          {deletion.sms ? (
            <>
              <Text
                accessibilityLiveRegion="polite"
                maxFontSizeMultiplier={1.3}
                style={styles.hint}
              >
                {t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.40d7acefbc',
                  'Verification code sent to '
                )}
                {deletion.sms.phoneNumberMasked}
              </Text>
              <TextInput
                accessibilityLabel={t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.78695e14bb',
                  'Delete Runtime SMS verification code'
                )}
                placeholder={t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.64ea7ccbea',
                  'Six-digit verification code'
                )}
                placeholderTextColor={theme.color.text.tertiary}
                value={deletion.smsCode}
                onChangeText={deletion.setSmsCode}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                maxFontSizeMultiplier={1.3}
                editable={!unavailable && !deletion.smsExpired}
                onFocus={() => setFocused('sms')}
                onBlur={() => setFocused(null)}
                style={[styles.input, focused === 'sms' && styles.focused]}
              />
            </>
          ) : null}
          {deletion.smsExpired ? (
            <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
              {t(
                'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.7a910173ad',
                'The verification code expired. Send a new one.'
              )}
            </Text>
          ) : null}
          <PairingActionButton
            variant="secondary"
            label={
              deletion.smsDailyLimited
                ? t(
                    'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.7f39a47882',
                    'Today’s SMS limit has been reached'
                  )
                : deletion.resendRemaining > 0
                  ? t(
                      'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.d0c37e0ba9',
                      'Resend in {{value0}}s',
                      { value0: deletion.resendRemaining }
                    )
                  : deletion.sms
                    ? t(
                        'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.ab211599b5',
                        'Resend verification code'
                      )
                    : t(
                        'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.4c9f7f87e3',
                        'Send verification code to your linked phone number'
                      )
            }
            labelStyle={{ flexShrink: 1, textAlign: 'center' }}
            disabled={unavailable || deletion.smsDailyLimited || deletion.resendRemaining > 0}
            onPress={() => void deletion.sendSms()}
          />
          <PairingActionButton
            label={
              deletion.busy
                ? t(
                    'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.0d555121ca',
                    'Processing…'
                  )
                : t(
                    'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.18fb79cfaa',
                    'Verify and delete Runtime'
                  )
            }
            variant="secondary"
            labelStyle={styles.error}
            disabled={!deletion.canSubmit}
            onPress={() => void deletion.confirm()}
          />
        </>
      ) : (
        <>
          <Text maxFontSizeMultiplier={1.3} style={styles.body}>
            {t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.c85a2d4d2b',
              'There is no Runtime available to delete. Check the devices in your account again.'
            )}
          </Text>
          <PairingActionButton
            label={t(
              'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.f21084a498',
              'Check again'
            )}
            disabled={unavailable}
            onPress={() => void deletion.review()}
          />
        </>
      )}
      {deletion.error ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          {deletion.error}
        </Text>
      ) : null}
      {deletion.requiresLogin ? (
        <PairingActionButton
          label={t(
            'auto.mobile.src.runtime.directory.MobileRuntimeDeleteScreen.d84aac680a',
            'Sign in again'
          )}
          onPress={() => router.push('/login')}
        />
      ) : null}
    </View>
  )
}
