import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Monitor } from 'lucide-react'
import type { HiveAccountSignInOptions } from '../../../../shared/hive-account'
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
  signingIn
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (sessionProfile: HiveAccountSignInOptions['sessionProfile']) => void
  signingIn: boolean
}): React.JSX.Element {
  const [trusted, setTrusted] = useState(false)

  useEffect(() => {
    if (!open) {
      setTrusted(false)
    }
  }, [open])

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
            {translate(
              'auto.components.settings.orcaAccount.signInConfirmDescription',
              'Review this request before the desktop app opens the secure browser sign-in.'
            )}
          </DialogDescription>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  )
}
