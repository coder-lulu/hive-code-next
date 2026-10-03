import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { SettingsNavigationTarget } from '@/lib/settings-navigation-types'
import { StatsPane } from '../stats/StatsPane'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { AccountsPane } from './AccountsPane'
import type { AccountsPaneProps } from './accounts-pane-types'

function targetTab(sectionId?: string | null): 'usage' | 'providers' {
  return sectionId === 'providers' || sectionId?.startsWith('accounts-') ? 'providers' : 'usage'
}

export function AiServicesPane({
  navigationRequest,
  ...accounts
}: AccountsPaneProps & { navigationRequest?: SettingsNavigationTarget | null }): React.JSX.Element {
  const [activeTab, setActiveTab] = useState(() => targetTab(accounts.navigationTargetSectionId))
  const [providersVisited, setProvidersVisited] = useState(activeTab === 'providers')
  useEffect(() => {
    if (!navigationRequest && !accounts.navigationTargetSectionId) {
      return
    }
    const next = targetTab(accounts.navigationTargetSectionId)
    setActiveTab(next)
    if (next === 'providers') {
      setProvidersVisited(true)
    }
  }, [navigationRequest, accounts.navigationTargetSectionId])

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (value !== 'usage' && value !== 'providers') {
          return
        }
        setActiveTab(value)
        if (value === 'providers') {
          setProvidersVisited(true)
        }
      }}
      className="gap-6"
    >
      <TabsList variant="line" aria-label={translate('aiServices.title', 'AI Services & Usage')}>
        <TabsTrigger value="usage">{translate('aiServices.usage', 'Usage')}</TabsTrigger>
        <TabsTrigger value="providers">
          {translate('aiServices.providers', 'AI Providers')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="usage" forceMount hidden={activeTab !== 'usage'}>
        <div id="usage">
          <StatsPane isActive={activeTab === 'usage'} />
        </div>
      </TabsContent>
      {providersVisited && (
        <TabsContent value="providers" forceMount hidden={activeTab !== 'providers'}>
          <div id="providers">
            <AccountsPane {...accounts} />
          </div>
        </TabsContent>
      )}
    </Tabs>
  )
}
