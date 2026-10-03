import { Ellipsis, RefreshCw, Trash2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'

export function AccountActionMenu({
  busy,
  reauthDisabled,
  onReauthenticate,
  onRemove
}: {
  busy: boolean
  reauthDisabled: boolean
  onReauthenticate: () => void
  onRemove: () => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={translate(
            'auto.components.settings.AccountsPane.accountActions',
            'Account actions'
          )}
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={reauthDisabled} onSelect={onReauthenticate}>
          <RefreshCw className="size-4" />
          {translate('auto.components.settings.AccountsPane.8a0f870153', 'Re-authenticate')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}>
          <Trash2 className="size-4" />
          {translate('auto.components.settings.AccountsPane.c2d2751587', 'Remove Account')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AccountAvatar({ value }: { value: string }): React.JSX.Element {
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
      {Array.from(value.trim())[0]?.toLocaleUpperCase() ?? 'A'}
    </div>
  )
}

export function AccountLoadState({ state }: { state: 'loading' | 'error' }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
      {state === 'loading'
        ? translate('auto.components.settings.AccountsPane.loadingAccounts', 'Loading accounts…')
        : translate(
            'auto.components.settings.AccountsPane.accountsUnavailable',
            'Accounts are temporarily unavailable. Retry from the provider card.'
          )}
    </div>
  )
}

export function EmptyAccounts(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
      {translate(
        'auto.components.settings.AccountsPane.noAddedAccounts',
        'No added accounts. The system default remains available.'
      )}
    </div>
  )
}
