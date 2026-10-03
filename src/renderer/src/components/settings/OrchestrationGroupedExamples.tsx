import { useState } from 'react'
import { ArrowRightLeft, ChevronRight, GitBranch, ListChecks } from 'lucide-react'
import { getOrchestrationUsageExamples } from '@/lib/orchestration-usage-examples'
import { ORCHESTRATION_SKILL_NAME } from '@/lib/agent-feature-install-commands'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { SkillUsageExampleDialog } from './SkillUsageExampleDialog'

const GROUPS = [
  {
    id: 'handoff',
    icon: ArrowRightLeft,
    title: () => translate('agentCapabilities.examples.handoff.title', 'Task handoff'),
    summary: () =>
      translate(
        'agentCapabilities.examples.handoff.summary',
        'Current task handoff · cross-worktree handoff'
      ),
    exampleIds: ['handoff', 'worktree-handoff']
  },
  {
    id: 'collaboration',
    icon: ListChecks,
    title: () =>
      translate('agentCapabilities.examples.collaboration.title', 'Sequential and parallel work'),
    summary: () =>
      translate(
        'agentCapabilities.examples.collaboration.summary',
        'Phased execution · independent parallel work'
      ),
    exampleIds: ['child-sequence', 'child-parallel']
  },
  {
    id: 'worktrees',
    icon: GitBranch,
    title: () =>
      translate('agentCapabilities.examples.worktrees.title', 'Worktrees and smaller PRs'),
    summary: () =>
      translate(
        'agentCapabilities.examples.worktrees.summary',
        'Split large changes into separate worktrees'
      ),
    exampleIds: ['child-worktrees']
  }
] as const

export function OrchestrationGroupedExamples({
  navigationTargetSectionId
}: {
  navigationTargetSectionId?: string | null
}): React.JSX.Element {
  const [openGroup, setOpenGroup] = useState<string | null>(
    navigationTargetSectionId === 'orchestration-examples' ? 'handoff' : null
  )
  const [previousNavigationTargetSectionId, setPreviousNavigationTargetSectionId] =
    useState(navigationTargetSectionId)
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(null)
  const examples = getOrchestrationUsageExamples()

  if (previousNavigationTargetSectionId !== navigationTargetSectionId) {
    setPreviousNavigationTargetSectionId(navigationTargetSectionId)
    if (navigationTargetSectionId === 'orchestration-examples') {
      setOpenGroup('handoff')
    }
  }

  return (
    <section
      id="orchestration-examples"
      className="agent-capabilities-examples scroll-mt-8 space-y-3"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-base font-semibold text-foreground">
          {translate('agentCapabilities.examplesTitle', 'Usage examples')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate(
            'agentCapabilities.examplesDescription',
            'Copy a prompt and use it in a coding session.'
          )}
        </p>
      </div>
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
        {GROUPS.map((group) => {
          const Icon = group.icon
          const expanded = openGroup === group.id
          return (
            <div key={group.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpenGroup(expanded ? null : group.id)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-accent"
              >
                <Icon className="size-4 shrink-0 text-foreground" />
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {group.title()}
                </span>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {group.summary()}
                </span>
                <ChevronRight
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
                />
              </button>
              {expanded ? (
                <div className="divide-y divide-border/60 border-t border-border/60 bg-muted/10 px-5">
                  {examples
                    .filter((example) =>
                      (group.exampleIds as readonly string[]).includes(example.id)
                    )
                    .map((example) => (
                      <Button
                        key={example.id}
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-start rounded-none px-0 py-3 text-left"
                        onClick={() => setSelectedExampleId(example.id)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{example.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            {example.summary}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0" />
                      </Button>
                    ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {examples.map((example) => (
        <SkillUsageExampleDialog
          key={example.id}
          example={example}
          icon={
            GROUPS.find((group) => (group.exampleIds as readonly string[]).includes(example.id))
              ?.icon ?? GitBranch
          }
          slashCommand={`/${ORCHESTRATION_SKILL_NAME}`}
          open={selectedExampleId === example.id}
          onOpenChange={(open) => setSelectedExampleId(open ? example.id : null)}
        />
      ))}
    </section>
  )
}
