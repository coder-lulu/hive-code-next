import { useTranslation } from 'react-i18next'
import { ArrowDown, CornerUpLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkflowStage } from './hive-workflow-draft'

export function HiveWorkflowGraph({
  stages,
  selected,
  disabled,
  onSelect
}: {
  stages: WorkflowStage[]
  selected: string | null
  disabled: boolean
  onSelect: (stageRef: string) => void
}) {
  const { t } = useTranslation()
  const label = (stageRef: string) => {
    const index = stages.findIndex((stage) => stage.stageRef === stageRef)
    return index === -1
      ? t('hiveWorkflow.unknownStage')
      : t('hiveWorkflow.stageLabel', {
          index: index + 1,
          role: t(`hiveWorkflow.roles.${stages[index].role}`)
        })
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t('hiveWorkflow.flowView')}</h3>
      <ol aria-label={t('hiveWorkflow.flowView')} className="divide-y divide-border">
        {stages.map((stage) => (
          <li
            key={stage.stageRef}
            className={cn('space-y-1 rounded-md py-2', selected === stage.stageRef && 'bg-accent')}
            data-current={selected === stage.stageRef ? 'true' : undefined}
          >
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-pressed={selected === stage.stageRef}
              className="h-auto w-full justify-start whitespace-normal text-left"
              onClick={() => onSelect(stage.stageRef)}
            >
              {label(stage.stageRef)}
            </Button>
            <div className="space-y-1 px-3 text-xs text-muted-foreground">
              <p className="flex items-start gap-2">
                <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {t('hiveWorkflow.dependsOnSummary', {
                    stages: stage.dependsOn.length
                      ? stage.dependsOn.map(label).join(', ')
                      : t('hiveWorkflow.noDependencies')
                  })}
                </span>
              </p>
              {stage.returnToStageRef && (
                <p className="flex items-start gap-2">
                  <CornerUpLeft className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {t('hiveWorkflow.returnSummary', { stage: label(stage.returnToStageRef) })}
                  </span>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
