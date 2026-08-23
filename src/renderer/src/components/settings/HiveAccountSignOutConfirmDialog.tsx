import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'

export function HiveAccountSignOutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  signingOut
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  signingOut: boolean
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.orcaAccount.signOutConfirmTitle',
              'Sign out of HiveCloud?'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.orcaAccount.signOutConfirmDescription',
              "This device's local credential will be removed. Local projects, worktrees, and provider accounts will not be affected."
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={signingOut}
          >
            {translate('auto.components.settings.orcaAccount.cancel', 'Cancel')}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={signingOut}>
            {signingOut ? <Loader2 className="size-4 animate-spin" /> : null}
            {translate('auto.components.settings.orcaAccount.signOut', 'Sign out')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
