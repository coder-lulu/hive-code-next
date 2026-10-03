import type { DiscoveredSkill, SkillDiscoverySource } from '../../../../shared/skills'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { resolveNestedWorkerMaxDepth } from '../../../../shared/nested-worker-depth'
import type { AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { NumberField } from './SettingsFormControls'
import { OrchestrationSkillAgentCoverage } from './OrchestrationSkillAgentCoverage'
import {
  getNestedWorkerDepthDescription,
  getNestedWorkerDepthTitle
} from './nested-worker-depth-copy'

export function OrchestrationCapabilitySettings({
  settings,
  updateSettings,
  skills,
  sources,
  loading,
  discoveryError,
  onSkillRecheck,
  showNestedWorkerDepth,
  comparable,
  detectionTarget
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
  skills: readonly DiscoveredSkill[]
  sources: readonly SkillDiscoverySource[]
  loading: boolean
  discoveryError: string | null
  onSkillRecheck: () => Promise<boolean>
  showNestedWorkerDepth: boolean
  comparable: boolean
  detectionTarget: AgentDetectionTarget
}): React.JSX.Element {
  return (
    <section className="agent-capabilities-settings scroll-mt-8 space-y-4">
      <h3 className="text-base font-semibold text-foreground">
        {translate('agentCapabilities.orchestrationSettings', 'Orchestration settings')}
      </h3>
      <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card px-5">
        <div className="space-y-2 py-4">
          <p className="text-sm font-medium text-foreground">
            {translate('agentCapabilities.agentCoverage', 'Agent coverage')}
          </p>
          <OrchestrationSkillAgentCoverage
            skills={skills}
            sources={sources}
            loading={loading}
            discoveryError={discoveryError}
            onSkillRecheck={onSkillRecheck}
            comparable={comparable}
            detectionTarget={detectionTarget}
            collapsible
          />
          <p className="text-xs text-muted-foreground">
            {translate(
              'agentCapabilities.coverageQualification',
              'A found skill confirms its path, not an end-to-end agent run.'
            )}
          </p>
        </div>
        {showNestedWorkerDepth ? (
          <div id="nested-worker-depth" className="scroll-mt-8 py-2">
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
          </div>
        ) : null}
      </div>
    </section>
  )
}
