import { ChevronRight, Coins, LoaderCircle, RefreshCw } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { formatAiInteger } from '../../../../shared/hive-ai-account'
import { useHiveAiRead } from '../settings/use-hive-ai-read'

const readAccount = () => window.api.hiveAccount.readAiAccount()
const copy = (key: string, fallback: string) =>
  translate(`components.sidebarApiQuota.${key}`, fallback)
type Props = { accountId: string | null; onOpenDetails: () => void; onSignIn: () => void }

export function SidebarApiQuota(props: Props) {
  if (props.accountId) {
    return (
      <SignedInQuota
        key={props.accountId}
        accountId={props.accountId}
        onOpenDetails={props.onOpenDetails}
      />
    )
  }
  return (
    <DropdownMenuItem asChild onSelect={props.onSignIn}>
      <button type="button" className="hive-account-menu-item w-full">
        <Coins className="hive-account-menu-icon" />
        <span>{copy('title', 'API balance')}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {copy('signIn', 'Sign in to view')}
        </span>
        <ChevronRight className="hive-account-menu-chevron" />
      </button>
    </DropdownMenuItem>
  )
}

function SignedInQuota({
  accountId,
  onOpenDetails
}: Pick<Props, 'onOpenDetails'> & { accountId: string }) {
  const { snapshot, loading, failed, refresh } = useHiveAiRead(accountId, readAccount)
  const current = snapshot?.accountId === accountId ? snapshot : null
  const balance = current?.balance
  const status = current?.account.status
  const available =
    !failed &&
    status === 'ACTIVE' &&
    balance?.accountStatus === 'ACTIVE' &&
    balance.freshness === 'CURRENT' &&
    balance.availableQuota !== null
  const label = loading
    ? copy('loading', 'Loading…')
    : failed
      ? copy('unavailable', 'Unavailable')
      : status === 'NOT_PROVISIONED'
        ? copy('notActivated', 'Not activated')
        : status === 'PENDING'
          ? copy('pending', 'Preparing…')
          : status === 'DISABLED'
            ? copy('disabled', 'Disabled')
            : available
              ? translate('components.sidebarApiQuota.points', '{{value}} points', {
                  value: formatAiInteger(balance.availableQuota, getIntlLocale())
                })
              : copy('unavailable', 'Unavailable')
  return (
    <div className="flex min-w-0 items-center gap-1" aria-busy={loading}>
      <DropdownMenuItem asChild onSelect={onOpenDetails}>
        <button type="button" className="hive-account-menu-item min-w-0 flex-1">
          <Coins className="hive-account-menu-icon" />
          <span className="shrink-0">{copy('title', 'API balance')}</span>
          <span
            role="status"
            className="ml-auto min-w-0 truncate text-xs tabular-nums text-muted-foreground"
            title={label}
          >
            {label}
          </span>
          <ChevronRight className="hive-account-menu-chevron" />
        </button>
      </DropdownMenuItem>
      <DropdownMenuItem
        asChild
        disabled={loading}
        onSelect={(event) => {
          event.preventDefault()
          void refresh()
        }}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={loading}
          aria-label={copy('refresh', 'Refresh API balance')}
        >
          {loading ? (
            <LoaderCircle className="size-4 motion-safe:animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
      </DropdownMenuItem>
    </div>
  )
}
