import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { HiveAccountSettingsPane } from './HiveAccountSettingsPane'
import type { HiveAccountSettingsContentProps } from './HiveAccountSettingsContent'
import { RuntimeEnvironmentsPane } from './RuntimeEnvironmentsPane'
import { SshPane } from './SshPane'
import { MobileCloudConnection } from '../mobile/MobileCloudConnection'
import { MobileConnectionPreferences } from '../mobile/MobileConnectionPreferences'
import { MobilePane } from './MobilePane'
import { DeviceAccessSettings } from './DeviceAccessSettings'
import { getDeviceConnectionsSearchTarget } from './device-connections-search'
import { RuntimePairingUrlGenerator } from './RuntimePairingUrlGenerator'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChevronDown } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  deviceConnectionsTabForSection,
  type DeviceConnectionsTab
} from '@/lib/device-connections-navigation'
import { useAppStore } from '@/store'

export type DeviceConnectionsPaneProps = {
  settings: GlobalSettings
  setActiveRuntimeEnvironmentPreference: (id: string | null) => Promise<boolean>
  isWebClient?: boolean
  active?: boolean
  searchQuery?: string
  requestedSectionId?: string | null
  initialTab?: DeviceConnectionsTab
  navigationRevision?: number
  addServerIntentSignal?: number
  sshHostAddIntentSignal?: number
}

export function DeviceConnectionsPane(props: DeviceConnectionsPaneProps): React.JSX.Element {
  const openAccount = (): void => {
    const store = useAppStore.getState()
    store.openSettingsPage()
    store.openSettingsTarget({ pane: 'orca-account', repoId: null })
  }
  return (
    <HiveAccountSettingsPane onOpenRuntimeDetails={openAccount}>
      {(account) => <DeviceConnectionsContent {...props} account={account} />}
    </HiveAccountSettingsPane>
  )
}

function DeviceConnectionsContent({
  account,
  ...props
}: DeviceConnectionsPaneProps & {
  account: HiveAccountSettingsContentProps
}): React.JSX.Element {
  const searchTarget = getDeviceConnectionsSearchTarget(
    props.searchQuery ?? '',
    Boolean(props.isWebClient)
  )
  const section = searchTarget ?? props.requestedSectionId
  const startingTab = props.isWebClient
    ? 'hosts'
    : section
      ? deviceConnectionsTabForSection(section)
      : (props.initialTab ?? 'hosts')
  const requestKey =
    section || props.initialTab
      ? `${props.navigationRevision ?? 0}:${section ?? props.initialTab}:${props.searchQuery ?? ''}`
      : null
  const serverIntent = props.addServerIntentSignal ?? 0
  const sshIntent = props.sshHostAddIntentSignal ?? 0
  const [selection, setSelection] = useState(() => ({
    requestKey,
    serverIntent,
    sshIntent,
    tab: startingTab,
    visited: new Set<DeviceConnectionsTab>([startingTab]),
    sshOpen: section === 'devices-ssh' || sshIntent > 0,
    sshVisited: section === 'devices-ssh' || sshIntent > 0
  }))
  if (
    requestKey !== selection.requestKey ||
    serverIntent !== selection.serverIntent ||
    sshIntent !== selection.sshIntent
  ) {
    const newSshIntent = sshIntent > 0 && sshIntent !== selection.sshIntent
    const newServerIntent = serverIntent > 0 && serverIntent !== selection.serverIntent
    const next =
      props.isWebClient || newSshIntent || newServerIntent
        ? 'hosts'
        : requestKey !== null && requestKey !== selection.requestKey
          ? startingTab
          : selection.tab
    // Reconcile a new navigation request before committing the screen. Retain
    // visited panels so pairing credentials survive navigation between areas.
    setSelection({
      requestKey,
      serverIntent,
      sshIntent,
      tab: next,
      visited: new Set([...selection.visited, next]),
      sshOpen: selection.sshOpen || newSshIntent || section === 'devices-ssh',
      sshVisited: selection.sshVisited || newSshIntent || section === 'devices-ssh'
    })
  }
  const { tab, visited, sshOpen, sshVisited } = selection
  const changeTab = (value: DeviceConnectionsTab): void => {
    setSelection((current) => ({
      ...current,
      tab: value,
      visited: new Set([...current.visited, value])
    }))
  }
  const setSshOpen = (value: boolean): void => {
    setSelection((current) => ({
      ...current,
      sshOpen: value,
      sshVisited: current.sshVisited || value
    }))
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => changeTab(value as DeviceConnectionsTab)}
      className="gap-5"
    >
      <TabsList
        className="w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto sm:w-fit"
        aria-label={translate('deviceConnections.title', 'Devices & connections')}
      >
        <TabsTrigger value="hosts" className="h-9 flex-none">
          {translate('deviceConnections.hosts', 'My hosts')}
        </TabsTrigger>
        {!props.isWebClient ? (
          <TabsTrigger value="this-computer" className="h-9 flex-none">
            {translate('deviceConnections.thisComputer', 'Connect to this computer')}
          </TabsTrigger>
        ) : null}
        {!props.isWebClient ? (
          <TabsTrigger value="access" className="h-9 flex-none">
            {translate('deviceConnections.access', 'Access management')}
          </TabsTrigger>
        ) : null}
      </TabsList>
      <TabsContent
        value="hosts"
        forceMount
        hidden={tab !== 'hosts'}
        className="space-y-5 data-[state=inactive]:hidden"
        id="devices-hosts"
      >
        {visited.has('hosts') ? (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              {translate(
                'deviceConnections.hostsDescription',
                'Your HiveCloud computers and paired hosts appear here. Add another host through address pairing or SSH.'
              )}
            </p>
            {account.state && account.state.status !== 'signed-in' ? (
              <Button
                variant="outline"
                onClick={account.onSignIn}
                disabled={!account.canSignIn || Boolean(account.busy)}
              >
                {translate('auto.components.settings.orcaAccount.signIn', 'Sign in to HiveCloud')}
              </Button>
            ) : null}
            <RuntimeEnvironmentsPane
              settings={props.settings}
              setActiveRuntimeEnvironmentPreference={props.setActiveRuntimeEnvironmentPreference}
              allowLocalRuntime={!props.isWebClient}
              addServerIntentSignal={props.addServerIntentSignal}
            />
            {!props.isWebClient ? (
              <Collapsible
                open={sshOpen}
                onOpenChange={setSshOpen}
                id="devices-ssh"
                className="rounded-xl border border-border/60 p-4"
              >
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="group w-full justify-between">
                    {translate('auto.hooks.useSettingsNavigationMetadata.94a5afe910', 'SSH Hosts')}
                    <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent forceMount hidden={!sshOpen} className="pt-4">
                  {sshVisited ? (
                    <SshPane addTargetIntentSignal={props.sshHostAddIntentSignal} />
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </>
        ) : null}
      </TabsContent>
      {!props.isWebClient ? (
        <TabsContent
          value="this-computer"
          forceMount
          hidden={tab !== 'this-computer'}
          className="space-y-6 data-[state=inactive]:hidden"
          id="devices-this-computer"
        >
          {visited.has('this-computer') ? (
            <>
              <MobilePane
                requestedConnectionMethod={
                  section === 'devices-direct'
                    ? 'direct'
                    : section === 'devices-this-computer'
                      ? 'cloud'
                      : undefined
                }
                navigationRevision={props.navigationRevision}
                active={props.active !== false && tab === 'this-computer'}
                cloudConnection={
                  <MobileCloudConnection
                    {...account}
                    onOpenRuntimeDetails={() => changeTab('hosts')}
                  />
                }
                directConnection={
                  <section className="space-y-3 border-t border-border/60 pt-5">
                    <h3 className="text-sm font-semibold">
                      {translate('deviceConnections.browserDesktop', 'Browser or another computer')}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {translate(
                        'deviceConnections.browserDesktopDescription',
                        'Create a revocable access link for a browser or another HiveCode desktop. Use the QR code above for the phone app.'
                      )}
                    </p>
                    <RuntimePairingUrlGenerator
                      framed={false}
                      showHeader={false}
                      showAccessList={false}
                    />
                  </section>
                }
              />
              <MobileConnectionPreferences onOpenConnectionDetails={() => changeTab('hosts')} />
            </>
          ) : null}
        </TabsContent>
      ) : null}
      {!props.isWebClient ? (
        <TabsContent
          value="access"
          forceMount
          hidden={tab !== 'access'}
          className="data-[state=inactive]:hidden"
          id="devices-access"
        >
          {visited.has('access') ? (
            <DeviceAccessSettings
              account={{ ...account, onOpenRuntimeDetails: () => changeTab('this-computer') }}
              active={props.active !== false && tab === 'access'}
            />
          ) : null}
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
