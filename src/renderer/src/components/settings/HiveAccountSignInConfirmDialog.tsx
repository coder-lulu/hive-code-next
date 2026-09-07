/* eslint-disable max-lines -- The sign-in dialog keeps its two authentication modes in one accessible flow. */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe2, Loader2, Monitor, ShieldCheck } from 'lucide-react'
import mascotUrl from '../../../../../resources/desktop-login-mascot.png'
import githubIconUrl from '../../../../../mobile/assets/auth-icons/github.png'
import wechatIconUrl from '../../../../../mobile/assets/auth-icons/wechat.png'
import qqIconUrl from '../../../../../mobile/assets/auth-icons/qq.png'
import { PRODUCT_LOGO_URL } from '@/product-brand'
import type {
  HiveAccountLoginProvider,
  HiveAccountLoginProviderId,
  HiveAccountSmsChallenge,
  HiveAccountSignInOptions
} from '../../../../shared/hive-account'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'

const NO_LOGIN_PROVIDERS: readonly HiveAccountLoginProvider[] = []

export function HiveAccountSignInConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  onSmsStart,
  onSmsCancel,
  onSmsComplete,
  providers = NO_LOGIN_PROVIDERS,
  signingIn
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (
    sessionProfile: HiveAccountSignInOptions['sessionProfile'],
    providerId?: HiveAccountLoginProviderId
  ) => void
  onSmsStart?: (
    phoneNumber: string,
    sessionProfile: HiveAccountSignInOptions['sessionProfile']
  ) => Promise<HiveAccountSmsChallenge>
  onSmsCancel?: () => Promise<void> | void
  onSmsComplete?: (challengeId: string, smsCode: string) => Promise<void>
  providers?: readonly HiveAccountLoginProvider[]
  signingIn: boolean
}): React.JSX.Element {
  useTranslation()
  const [method, setMethod] = useState<'sms' | 'browser'>('sms')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [challenge, setChallenge] = useState<HiveAccountSmsChallenge | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [smsError, setSmsError] = useState<string | null>(null)
  const [smsTermsAccepted, setSmsTermsAccepted] = useState(false)
  const [startingSms, setStartingSms] = useState(false)
  const smsAttempt = useRef(0)
  const smsBusy = signingIn || startingSms

  useEffect(() => {
    if (!open) {
      smsAttempt.current += 1
      setStartingSms(false)
      setMethod('sms')
      setPhoneNumber('')
      setSmsCode('')
      setChallenge(null)
      setSmsError(null)
      setSmsTermsAccepted(false)
    }
  }, [open])

  useEffect(() => {
    if (!open || !challenge || resendAt <= Date.now()) {
      setRemainingSeconds(0)
      return
    }
    const tick = (): void => {
      const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000))
      setRemainingSeconds(seconds)
      if (seconds === 0) {
        window.clearInterval(timer)
      }
    }
    const timer = window.setInterval(tick, 1000)
    tick()
    return () => window.clearInterval(timer)
  }, [open, challenge, resendAt])

  const startSms = async (): Promise<void> => {
    if (smsBusy || (challenge && Date.now() < resendAt)) {
      return
    }
    if (!onSmsStart || !/^\+?[0-9]{6,20}$/.test(phoneNumber.trim())) {
      setSmsError(
        translate('components.hiveAccountSignIn.invalidPhone', 'Enter a valid phone number.')
      )
      return
    }
    if (!smsTermsAccepted) {
      setSmsError(
        translate(
          'components.hiveAccountSignIn.acceptTermsError',
          'Please accept the Terms of Service and Privacy Policy first.'
        )
      )
      return
    }
    const attempt = ++smsAttempt.current
    setSmsError(null)
    setStartingSms(true)
    try {
      // The profile is part of the device-authorization request and must be
      // selected before the SMS exchange. Keep the login flow persistent by
      // default; the modal no longer exposes a pre-auth trust toggle.
      const nextChallenge = await onSmsStart(phoneNumber.trim(), 'TRUSTED')
      if (attempt === smsAttempt.current) {
        setResendAt(Date.now() + nextChallenge.resendAfterSeconds * 1000)
        setSmsCode('')
        setChallenge(nextChallenge)
      }
    } catch {
      if (attempt === smsAttempt.current) {
        setSmsError(
          translate(
            'components.hiveAccountSignIn.sendCodeFailed',
            'Could not send the code. Try again later.'
          )
        )
      }
    } finally {
      if (attempt === smsAttempt.current) {
        setStartingSms(false)
      }
    }
  }

  const completeSms = async (): Promise<void> => {
    if (!challenge || !/^\d{6}$/.test(smsCode)) {
      setSmsError(translate('components.hiveAccountSignIn.invalidCode', 'Enter the 6-digit code.'))
      return
    }
    setSmsError(null)
    try {
      await onSmsComplete?.(challenge.challengeId, smsCode)
    } catch {
      setSmsError(
        translate('components.hiveAccountSignIn.codeExpired', 'The code is invalid or expired.')
      )
    }
  }

  const startProviderSignIn = (providerId: HiveAccountLoginProviderId): void => {
    if (!smsTermsAccepted) {
      setSmsError(
        translate(
          'components.hiveAccountSignIn.acceptTermsError',
          'Please accept the Terms of Service and Privacy Policy first.'
        )
      )
      return
    }
    onConfirm('TRUSTED', providerId)
  }

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      smsAttempt.current += 1
      void onSmsCancel?.()
    }
    onOpenChange(nextOpen)
  }

  const switchMethod = (nextMethod: 'sms' | 'browser'): void => {
    if (nextMethod === 'browser') {
      smsAttempt.current += 1
      void onSmsCancel?.()
      setStartingSms(false)
      setChallenge(null)
      setSmsCode('')
    }
    setMethod(nextMethod)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton
        overlayClassName="hive-account-overlay"
        className="hive-account-dialog"
      >
        <div className="hive-account-dialog-shell">
          <aside className="hive-account-brand-panel">
            <div className="hive-account-brand-lockup">
              <img src={PRODUCT_LOGO_URL} alt="" />
              <div>
                <strong>HiveCloud</strong>
                <span>
                  {translate('components.hiveAccountSignIn.cloudConsole', 'Cloud control plane')}
                </span>
              </div>
            </div>
            <div className="hive-account-mascot-wrap">
              <img
                src={mascotUrl}
                alt={translate('components.hiveAccountSignIn.mascotAlt', 'HiveCode robot bee')}
              />
            </div>
            <div className="hive-account-brand-copy">
              <h2>
                {translate(
                  'components.hiveAccountSignIn.brandTitle',
                  'Secure connection, efficient collaboration'
                )}
              </h2>
              <p>
                {translate(
                  'components.hiveAccountSignIn.brandDescription',
                  'Manage Runtimes, devices, and sessions after signing in.'
                )}
              </p>
              <small>
                {translate(
                  'components.hiveAccountSignIn.brandNote',
                  'HiveCode local features remain available after you close this window.'
                )}
              </small>
            </div>
          </aside>

          <section className="hive-account-form-panel">
            <DialogHeader className="hive-account-form-header">
              <DialogTitle>
                {translate('components.hiveAccountSignIn.title', 'Sign in to HiveCloud')}
              </DialogTitle>
              <DialogDescription>
                {method === 'sms'
                  ? translate(
                      'components.hiveAccountSignIn.smsDescription',
                      'Verify your phone number to continue without leaving the app.'
                    )
                  : translate(
                      'components.hiveAccountSignIn.browserDescription',
                      'Complete secure authentication in your system browser and return to HiveCode automatically.'
                    )}
              </DialogDescription>
            </DialogHeader>

            <div
              className="hive-account-method-switch"
              role="tablist"
              aria-label={translate('components.hiveAccountSignIn.loginMethods', 'Sign-in methods')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={method === 'sms'}
                className={method === 'sms' ? 'is-active' : ''}
                onClick={() => switchMethod('sms')}
              >
                {translate('components.hiveAccountSignIn.smsTab', 'Phone code')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={method === 'browser'}
                className={method === 'browser' ? 'is-active' : ''}
                onClick={() => switchMethod('browser')}
              >
                {translate('components.hiveAccountSignIn.browserTab', 'Browser')}
              </button>
            </div>

            {method === 'sms' ? (
              <div className="hive-account-login-body">
                {!challenge ? (
                  <div className="hive-account-field">
                    <Label htmlFor="hive-account-phone">
                      {translate('components.hiveAccountSignIn.phoneLabel', 'Phone number')}
                    </Label>
                    <div
                      className={`hive-account-phone-input${smsError && !smsTermsAccepted ? ' has-error' : ''}`}
                    >
                      <span className="hive-account-country">+86</span>
                      <span className="hive-account-country-chevron" aria-hidden="true" />
                      <span className="hive-account-input-divider" aria-hidden="true" />
                      <input
                        id="hive-account-phone"
                        value={phoneNumber}
                        onChange={(event) => {
                          setPhoneNumber(event.target.value)
                          setSmsError(null)
                        }}
                        disabled={smsBusy}
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder={translate(
                          'components.hiveAccountSignIn.phonePlaceholder',
                          'Enter your phone number'
                        )}
                        aria-invalid={Boolean(smsError && !smsTermsAccepted)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="hive-account-code-summary">
                    <span>
                      {translate('components.hiveAccountSignIn.codeSentTo', 'Code sent to')}
                    </span>
                    <strong>
                      {phoneNumber.replace(/^(\+?86)?(\d{3})\d{4}(\d{4})$/, '$2 **** $3')}
                    </strong>
                  </div>
                )}
                {challenge ? (
                  <div className="hive-account-field">
                    <Label htmlFor="hive-account-sms-code">
                      {translate('components.hiveAccountSignIn.codeLabel', 'Verification code')}
                    </Label>
                    <input
                      id="hive-account-sms-code"
                      className="hive-account-text-input hive-account-code-input"
                      value={smsCode}
                      onChange={(event) =>
                        setSmsCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                      disabled={smsBusy}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder={translate(
                        'components.hiveAccountSignIn.codePlaceholder',
                        'Enter the 6-digit code'
                      )}
                    />
                    {remainingSeconds > 0 ? (
                      <p className="hive-account-code-hint">
                        {translate(
                          'components.hiveAccountSignIn.resendCountdown',
                          'Resend in {{seconds}}s',
                          { seconds: remainingSeconds }
                        )}
                      </p>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={smsBusy}
                        onClick={() => void startSms()}
                      >
                        {translate('components.hiveAccountSignIn.resendCode', 'Resend code')}
                      </Button>
                    )}
                  </div>
                ) : null}
                {!challenge ? (
                  <label className="hive-account-terms-row">
                    <Checkbox
                      checked={smsTermsAccepted}
                      onCheckedChange={(checked) => setSmsTermsAccepted(checked === true)}
                      disabled={smsBusy}
                    />
                    <span>
                      {translate(
                        'components.hiveAccountSignIn.termsPrefix',
                        'I have read and agree to'
                      )}{' '}
                      <a href="#terms">
                        {translate('components.hiveAccountSignIn.terms', 'Terms of Service')}
                      </a>{' '}
                      {translate('components.hiveAccountSignIn.and', 'and')}{' '}
                      <a href="#privacy">
                        {translate('components.hiveAccountSignIn.privacy', 'Privacy Policy')}
                      </a>
                    </span>
                  </label>
                ) : null}
                {smsError ? (
                  <p className="hive-account-error" role="alert">
                    {smsError}
                  </p>
                ) : null}
                <Button
                  type="button"
                  className="hive-account-primary"
                  onClick={() => void (challenge ? completeSms() : startSms())}
                  disabled={smsBusy}
                >
                  {smsBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {challenge
                    ? translate('components.hiveAccountSignIn.confirm', 'Sign in')
                    : smsBusy
                      ? translate('components.hiveAccountSignIn.sending', 'Sending…')
                      : translate('components.hiveAccountSignIn.getCode', 'Get code')}
                </Button>
              </div>
            ) : (
              <div className="hive-account-browser-body">
                <div className="hive-account-browser-icon">
                  <Globe2 aria-hidden="true" />
                </div>
                <strong>
                  {translate(
                    'components.hiveAccountSignIn.browserTitle',
                    'Complete secure authentication in your browser'
                  )}
                </strong>
                <p>
                  {translate(
                    'components.hiveAccountSignIn.browserDescription',
                    'You will return to HiveCode automatically after authentication.'
                  )}
                </p>
                <Button
                  type="button"
                  className="hive-account-primary"
                  onClick={() => onConfirm('TRUSTED')}
                  disabled={signingIn}
                >
                  {signingIn ? <Loader2 className="size-4 animate-spin" /> : null}
                  {signingIn
                    ? translate('components.hiveAccountSignIn.opening', 'Opening…')
                    : translate(
                        'components.hiveAccountSignIn.continueBrowser',
                        'Continue in browser'
                      )}
                </Button>
                <button
                  type="button"
                  className="hive-account-link-button"
                  onClick={() => void onConfirm('TRUSTED')}
                  disabled={signingIn}
                >
                  {translate('components.hiveAccountSignIn.copyLink', 'Copy sign-in link')}
                </button>
              </div>
            )}

            {method === 'sms' && !challenge && providers.length > 0 ? (
              <>
                <div className="hive-account-divider">
                  <span>
                    {translate(
                      'components.hiveAccountSignIn.otherMethods',
                      'Other sign-in methods'
                    )}
                  </span>
                </div>
                <div
                  className="hive-account-socials"
                  aria-label={translate(
                    'components.hiveAccountSignIn.otherMethods',
                    'Other sign-in methods'
                  )}
                >
                  {providers.map((provider) => {
                    const presentation =
                      provider.id === 'github'
                        ? {
                            iconUrl: githubIconUrl,
                            label: translate(
                              'components.hiveAccountSignIn.github',
                              'Sign in with GitHub'
                            )
                          }
                        : provider.id === 'wechat'
                          ? {
                              iconUrl: wechatIconUrl,
                              label: translate(
                                'components.hiveAccountSignIn.wechat',
                                'Sign in with WeChat'
                              )
                            }
                          : {
                              iconUrl: qqIconUrl,
                              label: translate('components.hiveAccountSignIn.qq', 'Sign in with QQ')
                            }
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        aria-label={presentation.label}
                        data-tooltip={presentation.label}
                        onClick={() => startProviderSignIn(provider.id)}
                        disabled={signingIn}
                      >
                        <img src={presentation.iconUrl} alt="" />
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}

            <div className="hive-account-security-bar">
              <ShieldCheck aria-hidden="true" />
              <div>
                <strong>
                  {translate(
                    'components.hiveAccountSignIn.securityTitle',
                    'Device credentials are protected'
                  )}
                </strong>
                <span>
                  {translate(
                    'components.hiveAccountSignIn.securityDescription',
                    'After sign-in, credentials are stored securely on this device.'
                  )}
                </span>
              </div>
            </div>
            <details className="hive-account-context">
              <summary>
                <span>
                  {translate(
                    'components.hiveAccountSignIn.contextSummary',
                    'HiveCode Desktop · Current device · Protected session'
                  )}
                </span>
                <span className="hive-account-context-chevron" aria-hidden="true" />
              </summary>
              <div className="hive-account-context-detail">
                <Monitor aria-hidden="true" />
                <span>
                  {translate(
                    'components.hiveAccountSignIn.contextDetails',
                    'Encrypted credentials are stored on this device and can be revoked in Account settings.'
                  )}
                </span>
              </div>
            </details>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
