import { Check, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

function SecurityRow({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 [@media(max-height:950px)]:min-h-9 [@media(max-height:950px)]:py-1">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <p className="min-w-32 flex-1 text-xs font-medium">{label}</p>
      <span className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{value}</span>
        <Check className="size-4 shrink-0" />
      </span>
    </div>
  )
}

export function HiveAccountSecuritySection({
  credentialProtection,
  busy,
  onSignOut
}: {
  credentialProtection: string
  busy: boolean
  onSignOut: () => void
}): React.JSX.Element {
  return (
    <section
      aria-labelledby="hive-account-security-title"
      className="overflow-hidden rounded-xl border border-border/60 bg-card"
    >
      <h3
        id="hive-account-security-title"
        className="px-4 py-2 text-sm font-semibold [@media(max-height:950px)]:py-1.5"
      >
        {translate('auto.components.settings.orcaAccount.securityAndAccount', 'Security & account')}
      </h3>
      <div className="divide-y divide-border/60 border-t border-border/60">
        <SecurityRow
          icon={<ShieldCheck className="size-4" />}
          label={translate(
            'auto.components.settings.orcaAccount.accountSecurity',
            'Account security'
          )}
          value={translate(
            'auto.components.settings.orcaAccount.accountSecurityDescription',
            'HiveCloud identity is active on this device'
          )}
        />
        <SecurityRow
          icon={<KeyRound className="size-4" />}
          label={translate(
            'auto.components.settings.orcaAccount.sessionCredential',
            'Session credential'
          )}
          value={credentialProtection}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-10 w-full justify-start rounded-none border-t border-border/60 px-4 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={busy}
        onClick={onSignOut}
      >
        <LogOut className="size-4" />
        {translate(
          'auto.components.settings.orcaAccount.signOutCurrentDevice',
          'Sign out of this device'
        )}
      </Button>
    </section>
  )
}
