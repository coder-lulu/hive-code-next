import { ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { useAppStore } from '@/store'
import { HiveAccountSettingsPane } from './HiveAccountSettingsPane'
import { OrcaLogoSettingsIcon } from './orca-logo-settings-icon'

export function AccountsOfficialService(): React.JSX.Element {
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)

  const openAccountSettings = (): void => {
    openSettingsPage()
    openSettingsTarget({ pane: 'orca-account', repoId: null })
  }

  return (
    <HiveAccountSettingsPane>
      {({ state }) => {
        const signedIn = state?.status === 'signed-in'
        const name =
          state?.account?.displayName ||
          state?.account?.accountId ||
          (state?.status === 'error'
            ? translate(
                'auto.components.settings.AccountsPane.accountStatusUnknown',
                'Account status unavailable'
              )
            : translate('auto.components.settings.AccountsPane.notSignedIn', 'Not signed in'))
        const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? 'H'
        return (
          <section
            aria-labelledby="accounts-official-service-title"
            className="overflow-hidden rounded-xl border border-border/70 bg-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <OrcaLogoSettingsIcon className="size-10 shrink-0" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id="accounts-official-service-title" className="text-base font-semibold">
                      {APP_DISPLAY_NAME}
                    </h3>
                    <Badge variant="secondary" className="rounded-md font-normal">
                      {translate(
                        'auto.components.settings.AccountsPane.officialService',
                        'Official service'
                      )}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {translate(
                      'auto.components.settings.AccountsPane.officialServiceDescription',
                      'Use your current HiveCode account; there is no need to add it again.'
                    )}
                  </p>
                </div>
              </div>
              <Button variant="link" className="h-8 shrink-0 px-0" onClick={openAccountSettings}>
                {translate(
                  'auto.components.settings.AccountsPane.manageOfficialAccount',
                  'Manage account'
                )}
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="accounts-official-status grid border-t border-border/60 px-5 py-3.5">
              <div className="accounts-official-identity flex min-w-0 items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {state ? (
                    initial
                  ) : (
                    <span className="size-4 animate-pulse rounded-full bg-muted-foreground/30" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {state
                      ? name
                      : translate(
                          'auto.components.settings.AccountsPane.loadingAccount',
                          'Loading account…'
                        )}
                  </p>
                  <p
                    className={cn(
                      'mt-1 flex items-center gap-1.5 text-xs text-muted-foreground',
                      signedIn && 'text-status-success'
                    )}
                  >
                    <span className="size-2 shrink-0 rounded-full bg-current" />
                    {signedIn
                      ? translate('auto.components.settings.AccountsPane.signedIn', 'Signed in')
                      : state?.status === 'error'
                        ? translate(
                            'auto.components.settings.AccountsPane.accountStatusUnknown',
                            'Account status unavailable'
                          )
                        : state
                          ? translate(
                              'auto.components.settings.AccountsPane.signedOut',
                              'Signed out'
                            )
                          : translate('auto.components.settings.AccountsPane.loading', 'Loading…')}
                  </p>
                </div>
              </div>
              <div className="accounts-official-model flex min-w-0 flex-wrap items-center gap-3">
                <span className="text-sm font-medium">
                  {translate('auto.components.settings.AccountsPane.modelService', 'Model service')}
                </span>
                <Badge
                  variant="secondary"
                  className="max-w-full whitespace-normal rounded-md font-normal text-muted-foreground"
                >
                  {translate(
                    'auto.components.settings.AccountsPane.modelServiceUnavailable',
                    'Not available in this version'
                  )}
                </Badge>
              </div>
            </div>
          </section>
        )
      }}
    </HiveAccountSettingsPane>
  )
}
