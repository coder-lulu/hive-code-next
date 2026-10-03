import {
  AzureDevOpsIntegrationCard,
  BitbucketIntegrationCard,
  GiteaIntegrationCard,
  GitHubIntegrationCard,
  GitLabIntegrationCard
} from './source-control-integration-cards'
import { JiraIntegrationCard, LinearIntegrationCard } from './task-tracker-integration-cards'
import { useIntegrationProviderStatusRefresh } from './use-integration-provider-status-refresh'
import { Monitor, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { getProviderAccountScope } from './provider-account-scope'
import { IntegrationCardPresentationProvider } from './integration-card-presentation'
import { integrationText } from './integration-settings-row'
export { getIntegrationsPaneSearchEntries } from './integrations-search'

export function IntegrationsPane(): React.JSX.Element {
  useIntegrationProviderStatusRefresh()
  const settings = useAppStore((state) => state.settings)
  const runtimeName = useAppStore(
    (state) =>
      state.runtimeEnvironments.find(
        (environment) => environment.id === settings?.activeRuntimeEnvironmentId
      )?.name
  )
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const scope = getProviderAccountScope(settings)
  return (
    <IntegrationCardPresentationProvider value="settings-list">
      <div className="integration-settings-page">
        <div className="integration-location-bar">
          <Monitor className="size-6 shrink-0" />
          <div className="min-w-0 flex-1 basis-48">
            <p className="font-medium">
              {integrationText('location', 'Connection location')}: {runtimeName || scope.label}
            </p>
            <p className="text-muted-foreground">
              {integrationText(
                'scopeDescription',
                'Credentials and connection status are managed by the current runtime.'
              )}
            </p>
          </div>
          <Button
            variant="link"
            onClick={() =>
              openSettingsTarget({ pane: 'servers', repoId: null, sectionId: 'default-runtime' })
            }
          >
            {integrationText('manageRuntimes', 'Manage runtimes')}
            <ArrowRight className="size-4" />
          </Button>
        </div>
        <section className="integration-settings-group">
          <h3>{integrationText('codePlatforms', 'Code platforms')}</h3>
          <GitHubIntegrationCard />
          <GitLabIntegrationCard />
          <BitbucketIntegrationCard />
          <AzureDevOpsIntegrationCard />
          <GiteaIntegrationCard />
        </section>
        <section className="integration-settings-group">
          <h3>{integrationText('taskTools', 'Task collaboration')}</h3>
          <LinearIntegrationCard />
          <JiraIntegrationCard />
        </section>
      </div>
    </IntegrationCardPresentationProvider>
  )
}
