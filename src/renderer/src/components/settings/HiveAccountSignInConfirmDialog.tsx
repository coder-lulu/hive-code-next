import { useEffect, useRef, useState } from 'react'
import { Globe2, Loader2, Monitor, ShieldCheck } from 'lucide-react'
import mascotUrl from '../../../../../resources/desktop-home-mascot-float.png'
import githubIconUrl from '../../../../../mobile/assets/auth-icons/github.png'
import wechatIconUrl from '../../../../../mobile/assets/auth-icons/wechat.png'
import qqIconUrl from '../../../../../mobile/assets/auth-icons/qq.png'
import { PRODUCT_LOGO_URL } from '@/product-brand'
import type { HiveAccountSignInOptions } from '../../../../shared/hive-account'
import type { HiveAccountSmsChallenge } from '../../../../shared/hive-account'
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

export function HiveAccountSignInConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  onSmsStart,
  onSmsCancel,
  onSmsComplete,
  signingIn
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (sessionProfile: HiveAccountSignInOptions['sessionProfile']) => void
  onSmsStart?: (
    phoneNumber: string,
    sessionProfile: HiveAccountSignInOptions['sessionProfile']
  ) => Promise<HiveAccountSmsChallenge>
  onSmsCancel?: () => Promise<void> | void
  onSmsComplete?: (challengeId: string, smsCode: string) => Promise<void>
  signingIn: boolean
}): React.JSX.Element {
  const [method, setMethod] = useState<'sms' | 'browser'>('sms')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [challenge, setChallenge] = useState<HiveAccountSmsChallenge | null>(null)
  const [smsError, setSmsError] = useState<string | null>(null)
  const [smsTermsAccepted, setSmsTermsAccepted] = useState(false)
  const [startingSms, setStartingSms] = useState(false)
  const smsAttempt = useRef(0)
  const smsBusy = signingIn || startingSms

  useEffect(() => {
    if (!open) {
      setMethod('sms')
      setPhoneNumber('')
      setSmsCode('')
      setChallenge(null)
      setSmsError(null)
      setSmsTermsAccepted(false)
    }
  }, [open])

  const startSms = async (): Promise<void> => {
    if (!onSmsStart || !/^\+?[0-9]{6,20}$/.test(phoneNumber.trim())) {
      setSmsError('请输入有效手机号。')
      return
    }
    if (!smsTermsAccepted) {
      setSmsError('请先同意《服务条款》和《隐私政策》。')
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
        setChallenge(nextChallenge)
      }
    } catch {
      if (attempt === smsAttempt.current) {
        setSmsError('验证码发送失败，请稍后重试。')
      }
    } finally {
      setStartingSms(false)
    }
  }

  const completeSms = async (): Promise<void> => {
    if (!challenge || !/^\d{6}$/.test(smsCode)) {
      setSmsError('请输入 6 位验证码。')
      return
    }
    setSmsError(null)
    try {
      await onSmsComplete?.(challenge.challengeId, smsCode)
    } catch {
      setSmsError('验证码无效或已过期。')
    }
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
                <span>云端控制面</span>
              </div>
            </div>
            <div className="hive-account-mascot-wrap">
              <img src={mascotUrl} alt="HiveCode 机器人小蜜蜂" />
            </div>
            <div className="hive-account-brand-copy">
              <h2>安全连接，高效协同</h2>
              <p>登录后可管理 Runtime、设备与会话。</p>
              <small>关闭窗口后仍可继续使用 HiveCode 本地功能。</small>
            </div>
          </aside>

          <section className="hive-account-form-panel">
            <DialogHeader className="hive-account-form-header">
              <DialogTitle>
                {translate(
                  'auto.components.settings.orcaAccount.signInConfirmTitle',
                  '登录 HiveCloud'
                )}
              </DialogTitle>
              <DialogDescription>
                {method === 'sms'
                  ? translate(
                      'auto.components.settings.orcaAccount.smsSignInDescription',
                      '验证手机号即可继续，无需离开当前应用。'
                    )
                  : translate(
                      'auto.components.settings.orcaAccount.signInConfirmDescription',
                      '将在系统浏览器中完成安全认证。认证完成后会自动返回 HiveCode。'
                    )}
              </DialogDescription>
            </DialogHeader>

            <div className="hive-account-method-switch" role="tablist" aria-label="登录方式">
              <button
                type="button"
                role="tab"
                aria-selected={method === 'sms'}
                className={method === 'sms' ? 'is-active' : ''}
                onClick={() => switchMethod('sms')}
              >
                手机验证码
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={method === 'browser'}
                className={method === 'browser' ? 'is-active' : ''}
                onClick={() => switchMethod('browser')}
              >
                浏览器登录
              </button>
            </div>

            {method === 'sms' ? (
              <div className="hive-account-login-body">
                {!challenge ? (
                  <div className="hive-account-field">
                    <Label htmlFor="hive-account-phone">手机号</Label>
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
                        placeholder="请输入手机号"
                        aria-invalid={Boolean(smsError && !smsTermsAccepted)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="hive-account-code-summary">
                    <span>验证码已发送至</span>
                    <strong>
                      {phoneNumber.replace(/^(\+?86)?(\d{3})\d{4}(\d{4})$/, '$2 **** $3')}
                    </strong>
                  </div>
                )}
                {challenge ? (
                  <div className="hive-account-field">
                    <Label htmlFor="hive-account-sms-code">验证码</Label>
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
                      placeholder="请输入 6 位验证码"
                    />
                    <p className="hive-account-code-hint">
                      {challenge.expiresInSeconds} 秒后重新发送
                    </p>
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
                      我已阅读并同意 <a href="#terms">《服务条款》</a> 和{' '}
                      <a href="#privacy">《隐私政策》</a>
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
                  {challenge ? '确认登录' : smsBusy ? '正在发送…' : '获取验证码'}
                </Button>
              </div>
            ) : (
              <div className="hive-account-browser-body">
                <div className="hive-account-browser-icon">
                  <Globe2 aria-hidden="true" />
                </div>
                <strong>将在系统浏览器中完成安全认证</strong>
                <p>认证完成后会自动返回 HiveCode。</p>
                <Button
                  type="button"
                  className="hive-account-primary"
                  onClick={() => onConfirm('TRUSTED')}
                  disabled={signingIn}
                >
                  {signingIn ? <Loader2 className="size-4 animate-spin" /> : null}
                  {signingIn ? '正在打开…' : '在浏览器中继续'}
                </Button>
                <button
                  type="button"
                  className="hive-account-link-button"
                  onClick={() => void onConfirm('TRUSTED')}
                  disabled={signingIn}
                >
                  复制登录链接
                </button>
              </div>
            )}

            {method === 'sms' && !challenge ? (
              <>
                <div className="hive-account-divider">
                  <span>其他登录方式</span>
                </div>
                <div className="hive-account-socials" aria-label="其他登录方式">
                  <button
                    type="button"
                    aria-label="使用 GitHub 登录"
                    data-tooltip="使用 GitHub 登录"
                    onClick={() => {}}
                  >
                    <img src={githubIconUrl} alt="" />
                  </button>
                  <button
                    type="button"
                    aria-label="使用微信登录"
                    data-tooltip="使用微信登录"
                    onClick={() => {}}
                  >
                    <img src={wechatIconUrl} alt="" />
                  </button>
                  <button
                    type="button"
                    aria-label="使用 QQ 登录"
                    data-tooltip="使用 QQ 登录"
                    onClick={() => {}}
                  >
                    <img src={qqIconUrl} alt="" />
                  </button>
                </div>
              </>
            ) : null}

            <div className="hive-account-security-bar">
              <ShieldCheck aria-hidden="true" />
              <div>
                <strong>设备凭据受到保护</strong>
                <span>登录成功后，凭据将安全保存在当前设备。</span>
              </div>
            </div>
            <details className="hive-account-context">
              <summary>
                <span>HiveCode Desktop · 当前设备 · 受保护会话</span>
                <span className="hive-account-context-chevron" aria-hidden="true" />
              </summary>
              <div className="hive-account-context-detail">
                <Monitor aria-hidden="true" />
                <span>当前设备将保存加密凭据，后续可在账户设置中撤销。</span>
              </div>
            </details>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
