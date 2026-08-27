import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Monitor } from 'lucide-react'
import type { HiveAccountSignInOptions } from '../../../../shared/hive-account'
import type { HiveAccountSmsChallenge } from '../../../../shared/hive-account'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  onSmsComplete?: (challengeId: string, smsCode: string) => Promise<void>
  signingIn: boolean
}): React.JSX.Element {
  const [trusted, setTrusted] = useState(false)
  const [method, setMethod] = useState<'sms' | 'browser'>('sms')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [challenge, setChallenge] = useState<HiveAccountSmsChallenge | null>(null)
  const [smsError, setSmsError] = useState<string | null>(null)
  const [smsTermsAccepted, setSmsTermsAccepted] = useState(false)

  useEffect(() => {
    if (!open) {
      setTrusted(false)
      setMethod('sms')
      setPhoneNumber('')
      setSmsCode('')
      setChallenge(null)
      setSmsError(null)
      setSmsTermsAccepted(false)
    }
  }, [open])

  const startSms = async (): Promise<void> => {
    if (!onSmsStart || !/^\+?[0-9]{6,20}$/.test(phoneNumber.trim()) || !smsTermsAccepted) {
      setSmsError('Enter a valid phone number and accept the terms.')
      return
    }
    setSmsError(null)
    try {
      setChallenge(await onSmsStart(phoneNumber.trim(), trusted ? 'TRUSTED' : 'TEMPORARY'))
    } catch {
      setSmsError('Unable to send a code. Try again.')
    }
  }

  const completeSms = async (): Promise<void> => {
    if (!challenge || !/^\d{6}$/.test(smsCode)) {
      setSmsError('Enter the 6-digit SMS code.')
      return
    }
    setSmsError(null)
    try {
      await onSmsComplete?.(challenge.challengeId, smsCode)
    } catch {
      setSmsError('The code is invalid or expired.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.orcaAccount.signInConfirmTitle',
              'Approve HiveCloud sign-in'
            )}
          </DialogTitle>
          <DialogDescription>
            {method === 'sms'
              ? translate(
                  'auto.components.settings.orcaAccount.smsSignInDescription',
                  'Verify your phone number to sign in without opening a browser.'
                )
              : translate(
                  'auto.components.settings.orcaAccount.signInConfirmDescription',
                  'Review this request before the desktop app opens the secure browser sign-in.'
                )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 border-b border-border/70 pb-3">
          <Button
            type="button"
            size="sm"
            variant={method === 'sms' ? 'default' : 'outline'}
            onClick={() => setMethod('sms')}
          >
            {translate('auto.components.settings.orcaAccount.smsLogin', 'Phone verification')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={method === 'browser' ? 'default' : 'outline'}
            onClick={() => setMethod('browser')}
          >
            {translate('auto.components.settings.orcaAccount.browserLogin', 'Browser sign-in')}
          </Button>
        </div>

        {method === 'sms' ? (
          <div className="space-y-3 rounded-lg border border-border/70 p-4">
            <div className="space-y-1">
              <Label htmlFor="hive-account-phone">
                {translate('auto.components.settings.orcaAccount.phoneNumber', 'Phone number')}
              </Label>
              <input
                id="hive-account-phone"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                disabled={Boolean(challenge) || signingIn}
                inputMode="tel"
                autoComplete="tel"
                placeholder="13800138000"
              />
            </div>
            {challenge ? (
              <div className="space-y-1">
                <Label htmlFor="hive-account-sms-code">
                  {translate('auto.components.settings.orcaAccount.smsCode', 'SMS code')}
                </Label>
                <input
                  id="hive-account-sms-code"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm tracking-[0.3em]"
                  value={smsCode}
                  onChange={(event) =>
                    setSmsCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  disabled={signingIn}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                />
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.orcaAccount.smsExpiry',
                    'Code expires in {seconds}s.'
                  ).replace('{seconds}', String(challenge.expiresInSeconds))}
                </p>
              </div>
            ) : null}
            <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <Checkbox
                checked={smsTermsAccepted}
                onCheckedChange={(checked) => setSmsTermsAccepted(checked === true)}
                disabled={signingIn}
              />
              <span>
                {translate(
                  'auto.components.settings.orcaAccount.smsTerms',
                  'I agree to the Terms of Service and Privacy Policy'
                )}
              </span>
            </label>
            {smsError ? (
              <p className="text-xs text-destructive" role="alert">
                {smsError}
              </p>
            ) : null}
            <Button
              type="button"
              className="w-full"
              onClick={() => void (challenge ? completeSms() : startSms())}
              disabled={signingIn}
            >
              {signingIn ? <Loader2 className="size-4 animate-spin" /> : null}
              {challenge
                ? translate('auto.components.settings.orcaAccount.verifySms', 'Verify and sign in')
                : translate(
                    'auto.components.settings.orcaAccount.sendSms',
                    'Send verification code'
                  )}
            </Button>
          </div>
        ) : null}

        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1 text-xs leading-5">
            <p className="font-medium">
              {translate(
                'auto.components.settings.orcaAccount.approvalSecurityTitle',
                'Short access credentials remain protected'
              )}
            </p>
            <p>
              {translate(
                'auto.components.settings.orcaAccount.approvalSecurityDescription',
                'The app rotates the 10-minute access token automatically. Your choice below controls the real sign-in authorization.'
              )}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-border/70 p-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">
              {translate('auto.components.settings.orcaAccount.requestStatus', 'Status')}
            </p>
            <p className="font-medium">
              {translate(
                'auto.components.settings.orcaAccount.pendingApproval',
                'Pending approval'
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              {translate('auto.components.settings.orcaAccount.requestApplication', 'Application')}
            </p>
            <p className="font-medium">
              {translate(
                'auto.components.settings.orcaAccount.requestApplicationName',
                'Desktop application'
              )}
            </p>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Monitor className="size-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.orcaAccount.requestDevice',
                  'Requesting device'
                )}
              </p>
              <p className="font-medium">
                {translate(
                  'auto.components.settings.orcaAccount.currentDesktop',
                  'This desktop app'
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
          <Checkbox
            id="hive-account-trusted-device"
            checked={trusted}
            onCheckedChange={(checked) => setTrusted(checked === true)}
            disabled={signingIn}
          />
          <div className="space-y-1">
            <Label htmlFor="hive-account-trusted-device">
              {translate(
                'auto.components.settings.orcaAccount.trustThisDevice',
                'Trust this device'
              )}
            </Label>
            <p className="text-xs leading-5 text-muted-foreground">
              {trusted
                ? translate(
                    'auto.components.settings.orcaAccount.trustedApprovalDescription',
                    'Keep an operating-system-encrypted sign-in for up to 90 days.'
                  )
                : translate(
                    'auto.components.settings.orcaAccount.temporaryApprovalDescription',
                    'Use a temporary sign-in for up to 24 hours; closing the app removes it.'
                  )}
            </p>
          </div>
        </div>

        {method === 'browser' ? (
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={signingIn}
            >
              {translate('auto.components.settings.orcaAccount.cancelRequest', 'Cancel request')}
            </Button>
            <Button
              size="sm"
              onClick={() => onConfirm(trusted ? 'TRUSTED' : 'TEMPORARY')}
              disabled={signingIn}
            >
              {signingIn ? <Loader2 className="size-4 animate-spin" /> : null}
              {translate('auto.components.settings.orcaAccount.approveSignIn', 'Approve sign-in')}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
