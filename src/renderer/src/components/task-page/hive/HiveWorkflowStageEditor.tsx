import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TaskProgressSummary } from '../../../../../shared/task-execution/task-execution-primitives'
import { HiveWorkbenchPicker } from './HiveWorkbenchPicker'
import { workflowStageAncestors, type WorkflowStage } from './hive-workflow-draft'

export function HiveWorkflowStageEditor({
  stage,
  stages,
  disabled,
  onChange,
  onRemove
}: {
  stage: WorkflowStage
  stages: WorkflowStage[]
  disabled: boolean
  onChange: (stage: WorkflowStage) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const index = stages.findIndex((item) => item.stageRef === stage.stageRef)
  const ancestors = workflowStageAncestors(stages, stage.stageRef)
  const stageLabel = (candidate: WorkflowStage) =>
    t('hiveWorkflow.stageLabel', {
      index: stages.findIndex((item) => item.stageRef === candidate.stageRef) + 1,
      role: t(`hiveWorkflow.roles.${candidate.role}`)
    })
  const returns = stages.filter(
    (candidate) =>
      ancestors.has(candidate.stageRef) &&
      (stage.role !== 'tester' || candidate.role === 'developer')
  )
  const canRemove =
    stages.length > 4 && stages.filter((item) => item.role === stage.role).length > 1
  const criteria = stage.acceptanceCriteria.map((criterion) => criterion.trim()).filter(Boolean)
  return (
    <fieldset disabled={disabled} className="space-y-3 border-t border-border pt-3">
      <legend className="text-sm font-medium">
        {t('hiveWorkflow.editStage', {
          index: index + 1,
          role: t(`hiveWorkflow.roles.${stage.role}`)
        })}
      </legend>
      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor="hive-workflow-criteria">{t('hiveWorkflow.acceptanceCriteria')}</Label>
          <p className="text-xs text-muted-foreground">{t('hiveWorkflow.criteriaHelp')}</p>
        </div>
        <Textarea
          id="hive-workflow-criteria"
          value={stage.acceptanceCriteria.join('\n')}
          rows={4}
          maxLength={32_783}
          aria-invalid={
            !criteria.length ||
            criteria.length > 16 ||
            criteria.some((criterion) => !TaskProgressSummary.safeParse(criterion).success)
          }
          onChange={(event) =>
            onChange({ ...stage, acceptanceCriteria: event.target.value.split('\n') })
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="hive-workflow-attempts">{t('hiveWorkflow.maxAttempts')}</Label>
        <Input
          id="hive-workflow-attempts"
          type="number"
          min={1}
          max={3}
          step={1}
          value={Number.isFinite(stage.maxAttempts) ? stage.maxAttempts : ''}
          aria-invalid={
            !Number.isInteger(stage.maxAttempts) || stage.maxAttempts < 1 || stage.maxAttempts > 3
          }
          onChange={(event) => onChange({ ...stage, maxAttempts: event.target.valueAsNumber })}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('hiveWorkflow.dependencies')}</legend>
        <p className="text-xs text-muted-foreground">{t('hiveWorkflow.dependenciesHelp')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {stages
            .filter((candidate) => candidate.stageRef !== stage.stageRef)
            .map((candidate) => (
              <div key={candidate.stageRef} className="flex items-start gap-2">
                <Checkbox
                  id={`hive-workflow-dependency-${candidate.stageRef}`}
                  disabled={disabled}
                  checked={stage.dependsOn.includes(candidate.stageRef)}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...stage,
                      dependsOn:
                        checked === true
                          ? [
                              ...stage.dependsOn.filter((ref) => ref !== candidate.stageRef),
                              candidate.stageRef
                            ]
                          : stage.dependsOn.filter((ref) => ref !== candidate.stageRef)
                    })
                  }
                />
                <Label htmlFor={`hive-workflow-dependency-${candidate.stageRef}`}>
                  {stageLabel(candidate)}
                </Label>
              </div>
            ))}
        </div>
      </fieldset>
      <div className="space-y-2">
        <div className="space-y-1">
          <Label htmlFor="hive-workflow-return">{t('hiveWorkflow.returnStage')}</Label>
          <p className="text-xs text-muted-foreground">{t('hiveWorkflow.returnHelp')}</p>
        </div>
        <HiveWorkbenchPicker
          id="hive-workflow-return"
          label={t('hiveWorkflow.returnStage')}
          placeholder={t('hiveWorkflow.chooseReturn')}
          value={stage.returnToStageRef ?? 'none'}
          disabled={disabled}
          items={[
            { id: 'none', name: t('hiveWorkflow.noReturn') },
            ...returns.map((candidate) => ({ id: candidate.stageRef, name: stageLabel(candidate) }))
          ]}
          onValueChange={(stageRef) => {
            const { returnToStageRef: _previous, ...rest } = stage
            onChange(stageRef === 'none' ? rest : { ...rest, returnToStageRef: stageRef })
          }}
        />
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || !canRemove}
          onClick={onRemove}
        >
          {t('hiveWorkflow.removeStage')}
        </Button>
      </div>
    </fieldset>
  )
}
