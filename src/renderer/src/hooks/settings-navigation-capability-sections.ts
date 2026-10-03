import { getStatsPaneSearchEntries } from '@/components/stats/stats-search'
import { LinearIcon } from '@/components/icons/LinearIcon'
import { getAccountsPaneSearchEntries } from '@/components/settings/accounts-search'
import { getAgentsPaneSearchEntries } from '@/components/settings/agents-search'
import { getComputerUsePaneSearchEntries } from '@/components/settings/computer-use-search'
import { getGeneralPaneSearchEntries } from '@/components/settings/general-search'
import { getIntegrationsPaneSearchEntries } from '@/components/settings/integrations-search'
import { getLinearAgentSkillPaneSearchEntries } from '@/components/settings/linear-agent-skill-search'
import { getOrcaAccountSettingsSearchEntries } from '@/components/settings/orca-account-settings-search'
import { OrcaLogoSettingsIcon } from '@/components/settings/orca-logo-settings-icon'
import { getOrchestrationPaneSearchEntries } from '@/components/settings/orchestration-search'
import { getVoicePaneSearchEntries } from '@/components/settings/voice-pane-search'
import { translate } from '@/i18n/i18n'
import type { SettingsNavSection } from '@/lib/settings-navigation-types'
import { APP_DISPLAY_NAME } from '@/product-brand'
import {
  Blocks,
  Bot,
  CircleUserRound,
  Mic,
  Network,
  SlidersHorizontal,
  UserCog
} from 'lucide-react'
import type { SettingsNavigationBuildOptions } from './settings-navigation-build-options'

export function buildCapabilitySettingsSections({
  isLocalWindowsHost,
  isWebClient,
  isLinearConnected
}: SettingsNavigationBuildOptions): SettingsNavSection[] {
  const showDesktopOnlySettings = !isWebClient
  return [
    {
      id: 'agents',
      title: translate('auto.hooks.useSettingsNavigationMetadata.b49abbd2f7', 'Agents'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.4121f7a0a2',
        'Manage AI agents, set a default, and customize commands.'
      ),
      icon: Bot,
      searchEntries: getAgentsPaneSearchEntries({
        includeAgentAwake: !isWebClient,
        includeAgentRuntime: isLocalWindowsHost,
        includeAgentWorkspaceTrust: !isWebClient,
        includeCodexTerminalServerIsolation: !isWebClient
      }),
      group: 'capabilities'
    },
    {
      id: 'accounts',
      title: translate('aiServices.title', 'AI Services & Usage'),
      description: translate(
        'aiServices.description',
        'View usage trends and manage AI provider accounts.'
      ),
      icon: UserCog,
      searchEntries: [
        ...getAccountsPaneSearchEntries().map((entry) => ({
          ...entry,
          targetSectionId: entry.targetSectionId ?? 'providers'
        })),
        ...getStatsPaneSearchEntries().map((entry) => ({ ...entry, targetSectionId: 'usage' }))
      ],
      group: 'capabilities'
    },
    {
      id: 'agent-capabilities',
      title: translate('agentCapabilities.settings.title', 'Agent Capabilities'),
      description: translate(
        'agentCapabilities.settings.description',
        'Configure multi-agent collaboration and desktop operation.'
      ),
      icon: Network,
      searchEntries: [
        ...getOrchestrationPaneSearchEntries({ includeNestedWorkerDepth: !isWebClient }),
        ...(showDesktopOnlySettings ? getComputerUsePaneSearchEntries() : [])
      ],
      group: 'capabilities'
    },
    // Why: only surfaced once Linear is connected — a capability that needs a
    // linked provider before the agent skill has anything to act on.
    ...(isLinearConnected
      ? [
          {
            id: 'linear',
            title: translate('auto.hooks.useSettingsNavigationMetadata.linearTitle', 'Linear'),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.linearDescription',
              `How Linear works in ${APP_DISPLAY_NAME}, setup checklist, agent skill, and example prompts.`
            ),
            icon: LinearIcon,
            searchEntries: getLinearAgentSkillPaneSearchEntries(),
            group: 'capabilities'
          }
        ]
      : []),
    ...(showDesktopOnlySettings
      ? [
          {
            id: 'voice',
            title: translate('auto.hooks.useSettingsNavigationMetadata.6a50cdcd7c', 'Voice'),
            description: translate(
              'auto.hooks.useSettingsNavigationMetadata.8ac3de82f5',
              'Local speech-to-text dictation with on-device models.'
            ),
            icon: Mic,
            searchEntries: getVoicePaneSearchEntries(),
            group: 'capabilities'
          }
        ]
      : [])
  ]
}

export function buildSetupSettingsSections({
  isLocalWindowsHost,
  isWebClient
}: SettingsNavigationBuildOptions): SettingsNavSection[] {
  const showDesktopOnlySettings = !isWebClient
  return [
    ...(showDesktopOnlySettings
      ? [
          {
            id: 'orca-account',
            title: translate('auto.components.settings.orcaAccount.title', 'Account & cloud'),
            description: translate(
              'auto.components.settings.orcaAccount.description',
              'Manage your HiveCloud account, usage, sign-in devices and security.'
            ),
            icon: CircleUserRound,
            searchEntries: getOrcaAccountSettingsSearchEntries(),
            group: 'setup'
          }
        ]
      : []),
    {
      id: 'setup-guide',
      title: translate(
        'auto.hooks.useSettingsNavigationMetadata.ded9e9032f',
        'Onboarding checklist'
      ),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.5f32ac08f3',
        `Finish the onboarding checklist for core ${APP_DISPLAY_NAME} workflows.`
      ),
      icon: OrcaLogoSettingsIcon,
      searchEntries: [
        {
          title: translate(
            'auto.hooks.useSettingsNavigationMetadata.ded9e9032f',
            'Onboarding checklist'
          ),
          description: translate(
            'auto.hooks.useSettingsNavigationMetadata.17005c73d4',
            'Open the onboarding checklist for setup and milestone steps.'
          ),
          keywords: [
            translate('auto.hooks.useSettingsNavigationMetadata.ea0b1bc7b8', 'setup guide'),
            translate(
              'auto.hooks.useSettingsNavigationMetadata.0505d0df29',
              `get started with ${APP_DISPLAY_NAME}`
            ),
            translate('auto.hooks.useSettingsNavigationMetadata.724c440e72', 'getting started')
          ]
        }
      ],
      group: 'setup'
    },
    {
      id: 'general',
      title: translate('auto.hooks.useSettingsNavigationMetadata.13241992bd', 'General'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.2cd4ea75da',
        'Workspace defaults, app setup, and maintenance.'
      ),
      icon: SlidersHorizontal,
      searchEntries: getGeneralPaneSearchEntries({ includeProjectRuntime: isLocalWindowsHost }),
      group: 'setup'
    },
    {
      id: 'integrations',
      title: translate('auto.hooks.useSettingsNavigationMetadata.2b043783ef', 'Integrations'),
      description: translate(
        'auto.hooks.useSettingsNavigationMetadata.33a5e1d597',
        'Connect GitHub, GitLab, Linear, and source-hosting services.'
      ),
      icon: Blocks,
      searchEntries: getIntegrationsPaneSearchEntries(),
      group: 'setup'
    }
  ]
}
