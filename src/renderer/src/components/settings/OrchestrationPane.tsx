import { useState } from 'react'
import {
  ArrowRightLeft,
  ChevronRight,
  GitBranch,
  ListChecks,
  MonitorCog,
  Workflow,
  type LucideIcon
} from 'lucide-react'
import {
  AGENT_SKILL_CLI_PREREQUISITE_NOTICE,
  ensureOrcaCliAvailableForAgentSkillTerminal
} from '@/lib/agent-skill-cli-prerequisite'
import { ORCHESTRATION_SKILL_NAME } from '@/lib/agent-feature-install-commands'
import type { SkillUsageExample } from '@/lib/skill-usage-example'
import {
  ORCHESTRATION_SKILL_INSTALL_COMMAND,
  ORCHESTRATION_SKILL_UPDATE_COMMAND
} from '@/lib/orchestration-install-command'
import { getOrchestrationUsageExamples } from '@/lib/orchestration-usage-examples'
import {
  GLOBAL_AGENT_SKILL_SOURCE_KINDS,
  useInstalledAgentSkill
} from '@/hooks/useInstalledAgentSkills'
import { useActiveProjectSkillRuntime } from '@/hooks/useActiveProjectSkillRuntime'
import { useActiveSkillDiscoveryRuntimeTarget } from '@/hooks/use-active-skill-discovery-runtime-target'
import { SearchableSetting } from './SearchableSetting'
import { matchesSettingsSearch } from './settings-search'
import { useAppStore } from '../../store'
import { getOrchestrationPaneSearchEntries } from './orchestration-search'
import { AgentSkillSetupPanel } from './AgentSkillSetupPanel'
import {
  buildSkillCommandForRuntime,
  ensureWslCliAvailableForAgentSkillTerminal,
  getWslCliDistroRequest
} from './CliSkillRuntimeSetup'
import { OrchestrationSkillAgentCoverage } from './OrchestrationSkillAgentCoverage'
import { OrchestrationCapabilitySettings } from './OrchestrationCapabilitySettings'
import { OrchestrationGroupedExamples } from './OrchestrationGroupedExamples'
import { ComputerUsePermissionsSection } from './ComputerUsePane'
import { ComputerUseSkillSetupPanel } from './ComputerUseSkillSetupPanel'
import { SkillUsageExamplesSection } from './SkillUsageExamplesSection'
import { OrchestrationSkillPromptDialog } from './OrchestrationSkillPromptDialog'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { resolveNestedWorkerMaxDepth } from '../../../../shared/nested-worker-depth'
import { isWebClientLocation } from '@/lib/web-client-location'
import { NumberField } from './SettingsFormControls'
import {
  getNestedWorkerDepthDescription,
  getNestedWorkerDepthTitle
} from './nested-worker-depth-copy'

const EXAMPLE_ICONS = {
  handoff: ArrowRightLeft,
  'worktree-handoff': ArrowRightLeft,
  'child-sequence': ListChecks,
  'child-parallel': GitBranch,
  'child-worktrees': Workflow
} as const

function resolveOrchestrationExampleIcon(example: SkillUsageExample): LucideIcon {
  return EXAMPLE_ICONS[example.id as keyof typeof EXAMPLE_ICONS] ?? Workflow
}

type OrchestrationPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
  embedded?: boolean
  showComputerUse?: boolean
  navigationTargetSectionId?: string | null
}

export function OrchestrationPane({
  settings,
  updateSettings,
  embedded = false,
  showComputerUse = false,
  navigationTargetSectionId
}: OrchestrationPaneProps): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  const showNestedWorkerDepth = !isWebClientLocation()
  const searchEntries = getOrchestrationPaneSearchEntries({
    includeNestedWorkerDepth: showNestedWorkerDepth
  })
  const showOrchestration = matchesSettingsSearch(searchQuery, searchEntries)
  const [skillPromptOpen, setSkillPromptOpen] = useState(false)
  const activeSkillRuntime = useActiveProjectSkillRuntime()
  const runtimeTarget = useActiveSkillDiscoveryRuntimeTarget()
  const orchestrationInstallCommand = !activeSkillRuntime.installDisabledReason
    ? buildSkillCommandForRuntime(
        ORCHESTRATION_SKILL_INSTALL_COMMAND,
        activeSkillRuntime.agentRuntime
      )
    : ORCHESTRATION_SKILL_INSTALL_COMMAND
  const orchestrationUpdateCommand = !activeSkillRuntime.installDisabledReason
    ? buildSkillCommandForRuntime(
        ORCHESTRATION_SKILL_UPDATE_COMMAND,
        activeSkillRuntime.agentRuntime
      )
    : ORCHESTRATION_SKILL_UPDATE_COMMAND

  const {
    installed: orchestrationSkillDetected,
    loading: orchestrationSkillLoading,
    error: orchestrationSkillError,
    skills: discoveredSkills,
    sources: discoveredSkillSources,
    refresh: refreshOrchestrationSkill
  } = useInstalledAgentSkill(ORCHESTRATION_SKILL_NAME, {
    discoveryTarget: activeSkillRuntime.discoveryTarget,
    sourceKinds: GLOBAL_AGENT_SKILL_SOURCE_KINDS
  })

  if (!embedded && !showOrchestration) {
    return <div />
  }

  const skillSetupPanel = (
    <AgentSkillSetupPanel
      title={
        embedded
          ? translate('agentCapabilities.orchestrationTitle', 'Multi-agent orchestration')
          : translate(
              'auto.components.settings.OrchestrationPane.07641b9768',
              'Orchestration skill'
            )
      }
      description={
        embedded
          ? translate(
              'agentCapabilities.orchestrationDescription',
              'Coordinate task handoffs and sequential or parallel child agents.'
            )
          : translate(
              'auto.components.settings.OrchestrationPane.9bedd2a6e5',
              'Enables agents to hand off context and coordinate work through Orca.'
            )
      }
      command={orchestrationInstallCommand}
      installedCommand={orchestrationUpdateCommand}
      terminalTitle="Orchestration setup"
      terminalAriaLabel="Orchestration skill install terminal"
      terminalWorktreeId="settings-orchestration-skill-terminal"
      terminalShellOverride={activeSkillRuntime.terminalShellOverride}
      terminalRuntime={activeSkillRuntime.agentRuntime}
      installed={orchestrationSkillDetected}
      loading={orchestrationSkillLoading}
      error={activeSkillRuntime.installDisabledReason ?? orchestrationSkillError}
      installDisabled={Boolean(activeSkillRuntime.installDisabledReason)}
      icon={<Workflow className="size-5" />}
      preInstallNotice={
        embedded
          ? translate(
              'agentCapabilities.cliRegistrationNotice',
              'Setup may ask to register the HiveCode CLI command on PATH.'
            )
          : AGENT_SKILL_CLI_PREREQUISITE_NOTICE
      }
      installVariant={embedded && !orchestrationSkillDetected ? 'default' : 'outline'}
      installLabel={
        embedded ? translate('agentCapabilities.installSkill', 'Install skill') : undefined
      }
      getPrerequisiteStatus={() =>
        activeSkillRuntime.agentRuntime?.runtime === 'wsl'
          ? window.api.cli.getWslInstallStatus(
              getWslCliDistroRequest(activeSkillRuntime.agentRuntime)
            )
          : window.api.cli.getInstallStatus()
      }
      onBeforeOpenTerminal={async () => {
        useAppStore.getState().recordFeatureInteraction('agent-orchestration-setup')
        await (activeSkillRuntime.agentRuntime?.runtime === 'wsl'
          ? ensureWslCliAvailableForAgentSkillTerminal(activeSkillRuntime.agentRuntime)
          : ensureOrcaCliAvailableForAgentSkillTerminal())
      }}
      actionHint={
        activeSkillRuntime.installDisabledReason ||
        orchestrationSkillError ||
        orchestrationSkillDetected ? null : (
          <p className="text-[12px] leading-snug text-muted-foreground">
            {translate(
              'auto.components.settings.OrchestrationPane.832f1f3ee6',
              'Prefer your own terminal?'
            )}{' '}
            <button
              type="button"
              className="font-medium text-foreground underline-offset-2 hover:underline"
              onClick={() => setSkillPromptOpen(true)}
            >
              {translate(
                'auto.components.settings.OrchestrationPane.7bc082f4de',
                'Copy install command'
              )}
            </button>
          </p>
        )
      }
      footer={
        embedded ? undefined : (
          <OrchestrationSkillAgentCoverage
            embedded
            skills={discoveredSkills}
            sources={discoveredSkillSources}
            loading={orchestrationSkillLoading}
          />
        )
      }
      onRecheck={refreshOrchestrationSkill}
      freshnessSkillName={
        activeSkillRuntime.canUseLocalSkillFreshness ? ORCHESTRATION_SKILL_NAME : undefined
      }
    />
  )

  const skillPromptDialog = (
    <OrchestrationSkillPromptDialog
      command={orchestrationInstallCommand}
      open={skillPromptOpen}
      onOpenChange={setSkillPromptOpen}
    />
  )

  if (embedded) {
    const comparable = Boolean(runtimeTarget) && activeSkillRuntime.agentRuntime?.runtime !== 'wsl'
    const detectionTarget =
      runtimeTarget?.kind === 'environment'
        ? { kind: 'runtime' as const, environmentId: runtimeTarget.environmentId }
        : { kind: 'local' as const }
    return (
      <>
        <div id="orchestration" className="agent-capabilities-orchestration-card scroll-mt-8">
          {skillSetupPanel}
        </div>
        {showComputerUse ? (
          <div id="computer-use" className="agent-capabilities-computer-card scroll-mt-8">
            <ComputerUseSkillSetupPanel embedded />
          </div>
        ) : null}
        <OrchestrationCapabilitySettings
          settings={settings}
          updateSettings={updateSettings}
          skills={discoveredSkills}
          sources={discoveredSkillSources}
          loading={orchestrationSkillLoading}
          discoveryError={orchestrationSkillError}
          onSkillRecheck={refreshOrchestrationSkill}
          showNestedWorkerDepth={showNestedWorkerDepth}
          comparable={comparable}
          detectionTarget={detectionTarget}
        />
        {showComputerUse ? (
          <div className="agent-capabilities-permissions">
            <ComputerUsePermissionsSection />
          </div>
        ) : null}
        <OrchestrationGroupedExamples navigationTargetSectionId={navigationTargetSectionId} />
        {showComputerUse ? (
          <details className="agent-capabilities-explanation group overflow-hidden rounded-xl border border-border/70 bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm font-medium text-foreground hover:bg-accent [&::-webkit-details-marker]:hidden">
              <MonitorCog className="size-4 shrink-0" />
              <span className="flex-1">
                {translate('agentCapabilities.computerUseExplanation', 'About Computer Use')}
              </span>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
            </summary>
            <p className="border-t border-border/60 px-5 py-4 text-xs leading-relaxed text-muted-foreground">
              {translate(
                'agentCapabilities.computerUseExplanationBody',
                'When requested, agents can inspect screenshots or app interfaces and perform supported clicks, typing, and scrolling. Access depends on the app, runtime, and local system permissions.'
              )}
            </p>
          </details>
        ) : null}
        {skillPromptDialog}
      </>
    )
  }

  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.OrchestrationPane.191ac34567',
        'Agent Orchestration'
      )}
      description={translate(
        'auto.components.settings.OrchestrationPane.2aacdb0517',
        'Coordinate coding agents across handoffs, worktree handovers, and child-agent work.'
      )}
      keywords={searchEntries[0].keywords}
      forceVisible
      className="space-y-5 py-2"
    >
      {skillSetupPanel}

      {showNestedWorkerDepth ? (
        <NumberField
          label={getNestedWorkerDepthTitle()}
          description={getNestedWorkerDepthDescription()}
          value={resolveNestedWorkerMaxDepth(settings)}
          min={1}
          integer
          onChange={(nestedWorkerMaxDepth) => {
            void updateSettings({ nestedWorkerMaxDepth })
          }}
        />
      ) : null}

      {skillPromptDialog}

      <SkillUsageExamplesSection
        heading={translate(
          'auto.components.settings.OrchestrationPane.ae79504732',
          'How to use it'
        )}
        description={translate(
          'auto.components.settings.OrchestrationPane.52e0634e2c',
          'Ask a coordinator agent to use orchestration for handoffs, worktree handovers, and sequential or parallel child agents.'
        )}
        examples={getOrchestrationUsageExamples()}
        resolveIcon={resolveOrchestrationExampleIcon}
        slashCommand={`/${ORCHESTRATION_SKILL_NAME}`}
      />
    </SearchableSetting>
  )
}
