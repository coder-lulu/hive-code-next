import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { HiveWorkflowSnapshot } from '../../../../../shared/hive-task-workflows'
import type { HiveWorkflowModel } from './use-hive-workflows'
import { HiveWorkflowGraph } from './HiveWorkflowGraph'

export function HiveWorkflowConflictReview({
  snapshot,
  model
}: {
  snapshot: HiveWorkflowSnapshot
  model: HiveWorkflowModel
}) {
  const { t } = useTranslation()
  return (
    <section
      className="space-y-3 border-y border-border py-3"
      aria-labelledby="hive-workflow-review-heading"
    >
      <div className="space-y-1">
        <h3 id="hive-workflow-review-heading" className="text-sm font-medium">
          {t('hiveWorkflow.reviewHeading', {
            name: snapshot.name,
            revision: snapshot.definition.workflowRevision
          })}
        </h3>
        <p className="text-xs text-muted-foreground">{t('hiveWorkflow.reviewHelp')}</p>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t('hiveWorkflow.maxParallelism')}</dt>
          <dd>{snapshot.definition.maxParallelism}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('hiveWorkflow.maxDuration')}</dt>
          <dd>{snapshot.definition.maxDurationMs / 1000}</dd>
        </div>
      </dl>
      <details open>
        <summary className="cursor-pointer text-sm font-medium">
          {t('hiveWorkflow.currentDefinition')}
        </summary>
        <div className="space-y-3 pt-3">
          <HiveWorkflowGraph
            stages={snapshot.definition.stages}
            selected={null}
            disabled
            onSelect={() => undefined}
          />
          <ol className="space-y-3">
            {snapshot.definition.stages.map((stage, index) => (
              <li key={stage.stageRef} className="space-y-1">
                <p className="text-sm font-medium">
                  {t('hiveWorkflow.stageLabel', {
                    index: index + 1,
                    role: t(`hiveWorkflow.roles.${stage.role}`)
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('hiveWorkflow.attemptsSummary', { attempts: stage.maxAttempts })}
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {stage.acceptanceCriteria.map((criterion, criterionIndex) => (
                    <li key={criterionIndex} className="break-words whitespace-pre-wrap">
                      {criterion}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </details>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={model.busy}
          onClick={model.adoptReviewedBase}
        >
          {t('hiveWorkflow.adoptReviewedBase')}
        </Button>
      </div>
    </section>
  )
}
