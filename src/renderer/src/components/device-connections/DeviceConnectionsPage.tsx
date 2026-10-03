import { ArrowLeft, Settings2 } from 'lucide-react'
import { DeviceConnectionsPane } from '../settings/DeviceConnectionsPane'
import { useDeviceConnectionsPageEscape } from './use-device-connections-page-escape'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isWebClientLocation } from '@/lib/web-client-location'

export default function DeviceConnectionsPage(): React.JSX.Element {
  const closePage = useAppStore((state) => state.closeDeviceConnectionsPage)
  const settings = useAppStore((state) => state.settings)
  const setActiveRuntimeEnvironmentPreference = useAppStore(
    (state) => state.setActiveRuntimeEnvironmentPreference
  )
  const request = useAppStore((state) => state.deviceConnectionsRequest)
  const isWebClient = isWebClientLocation()
  useDeviceConnectionsPageEscape(closePage)
  const openAccount = (): void => {
    const store = useAppStore.getState()
    store.openSettingsPage()
    store.openSettingsTarget({ pane: 'orca-account', repoId: null })
  }
  return (
    <div className="device-connections-page-root h-full overflow-y-auto bg-background text-foreground scrollbar-sleek">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/60 bg-background px-5 py-3">
        <Button variant="ghost" onClick={closePage}>
          <ArrowLeft />
          {translate('phoneConnection.back', 'Back')}
        </Button>
        {!isWebClient ? (
          <Button variant="ghost" onClick={openAccount}>
            <Settings2 />
            {translate('phoneConnection.accountSettings', 'Account settings')}
          </Button>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-4xl space-y-6 px-5 py-6 sm:px-8">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">
            {translate('deviceConnections.title', 'Devices & connections')}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {translate(
              'deviceConnections.description',
              'Manage your computers, connect to this computer and control cross-device access.'
            )}
          </p>
        </div>
        {settings ? (
          <DeviceConnectionsPane
            settings={settings}
            setActiveRuntimeEnvironmentPreference={setActiveRuntimeEnvironmentPreference}
            initialTab={request.tab}
            navigationRevision={request.revision}
            isWebClient={isWebClient}
          />
        ) : null}
      </main>
    </div>
  )
}
