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
              'Signing out removes HiveCloud login credentials from this device. Local projects, worktrees, terminals, and AI provider accounts are not affected.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="h-10"
            onClick={() => onOpenChange(false)}
            disabled={signingOut}
          >
            {translate('auto.components.settings.orcaAccount.cancel', 'Cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-10"
            onClick={onConfirm}
            disabled={signingOut}
          >
            {signingOut ? <Loader2 className="size-4 animate-spin" /> : null}
            {translate('auto.components.settings.orcaAccount.signOut', 'Sign out')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
