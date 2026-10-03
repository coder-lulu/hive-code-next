import type { HiveAccountSettingsContentProps } from './HiveAccountSettingsContent'
import { HiveRuntimeSessionsSettings } from './HiveRuntimeSessionsSettings'
import { accountPlatformLabel, accountSessionProfileLabel } from './hive-account-settings-view'
import { MobileDeviceAccessSettings } from './MobileDeviceAccessSettings'
import { RuntimePairingUrlGenerator } from './RuntimePairingUrlGenerator'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

const KEEP_RUNTIME_TAB = (): void => undefined

export function DeviceAccessSettings({
  account,
  active
}: {
  account: HiveAccountSettingsContentProps
  active: boolean
}): React.JSX.Element {
  const { state, directory } = account
  const authorized =
    state?.status === 'signed-in' &&
    Boolean(state.account?.accountId) &&
    state.errorCode !== 'session_expired' &&
    state.errorCode !== 'session_rejected'
  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-muted-foreground">
        {translate(
          'deviceConnections.accessDescription',
          'Manage cloud sessions, phone pairing and shared access here. Each revoke action affects only the selected access type. Manage account sign-in devices in Account settings.'
        )}
      </p>
      {authorized && directory.accountId === state.account?.accountId ? (
        <HiveRuntimeSessionsSettings
          key={`${state.authorityId}:${state.account?.accountId}:${directory.sessionGeneration}`}
          currentDevice={{
            label: state.deviceLabel ?? '',
            platform: accountPlatformLabel(account.platformInfo),
            profile: accountSessionProfileLabel(state.sessionProfile),
            authorizationExpiresAt: state.sessionExpiresAt
          }}
          activeTab="runtime"
          runtimeOnly
          active={active}
          onActiveTabChange={KEEP_RUNTIME_TAB}
          onOpenConnectionHelp={account.onOpenRuntimeDetails}
        />
      ) : (
        <section className="space-y-3 rounded-xl border border-border/60 p-4">
          <h3 className="text-sm font-semibold">
            {translate('phoneConnection.cloudSessions', 'HiveCloud access sessions')}
          </h3>
          {!state || authorized ? (
            <p className="text-sm text-muted-foreground" role="status">
              {translate('deviceConnections.syncingAccess', 'Syncing HiveCloud account access…')}
            </p>
          ) : null}
          <Button
            variant="outline"
            disabled={(!authorized && !account.canSignIn) || account.busy !== null}
            onClick={authorized ? account.onRefresh : account.onSignIn}
          >
            {authorized
              ? translate('auto.components.settings.orcaAccount.refresh', 'Refresh')
              : translate('auto.components.settings.orcaAccount.signIn', 'Sign in to HiveCloud')}
          </Button>
        </section>
      )}
      <MobileDeviceAccessSettings active={active} />
      <section className="rounded-xl border border-border/60 bg-card p-4">
        <RuntimePairingUrlGenerator
          framed={false}
          showHeader={false}
          showGeneratorForm={false}
          active={active}
        />
      </section>
    </div>
  )
}
