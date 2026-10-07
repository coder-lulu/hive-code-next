import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  appendWorkflowStage,
  removeWorkflowStage,
  workflowRoles,
  type HiveWorkflowDraft,
  type WorkflowRole
} from './hive-workflow-draft'
import type { HiveWorkflowModel } from './use-hive-workflows'
import { HiveWorkflowGraph } from './HiveWorkflowGraph'
import { HiveWorkflowStageEditor } from './HiveWorkflowStageEditor'

export function HiveWorkflowDraftForm({
  draft,
  model
}: {
  draft: HiveWorkflowDraft
  model: HiveWorkflowModel
}) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const [addingRole, setAddingRole] = useState<WorkflowRole>('developer')
  const selectedStage = draft.stages.find((stage) => stage.stageRef === selected) ?? draft.stages[0]
  const disabled = model.busy || model.historical
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void model.save().then((success) => {
          if (success) {
            toast.success(t('hiveWorkflow.saved'))
          }
        })
      }}
    >
      <fieldset disabled={disabled} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="hive-workflow-name">{t('hiveWorkflow.name')}</Label>
          <Input
            id="hive-workflow-name"
            value={draft.name}
            maxLength={160}
            required
            aria-invalid={!draft.name.trim()}
            onChange={(event) => {
              const name = event.target.value
              model.edit((previous) => ({ ...previous, name }))
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="hive-workflow-parallelism">{t('hiveWorkflow.maxParallelism')}</Label>
            <Input
              id="hive-workflow-parallelism"
              type="number"
              min={1}
              max={4}
              step={1}
              value={Number.isFinite(draft.maxParallelism) ? draft.maxParallelism : ''}
              aria-invalid={
                !Number.isInteger(draft.maxParallelism) ||
                draft.maxParallelism < 1 ||
                draft.maxParallelism > 4
              }
              onChange={(event) => {
                const maxParallelism = event.target.valueAsNumber
                model.edit((previous) => ({ ...previous, maxParallelism }))
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hive-workflow-duration">{t('hiveWorkflow.maxDuration')}</Label>
            <Input
              id="hive-workflow-duration"
              type="number"
              min={1}
              max={86_400}
              step={0.001}
              value={Number.isFinite(draft.maxDurationMs) ? draft.maxDurationMs / 1000 : ''}
              aria-invalid={
                !Number.isInteger(draft.maxDurationMs) ||
                draft.maxDurationMs < 1000 ||
                draft.maxDurationMs > 86_400_000
              }
              onChange={(event) => {
                const maxDurationMs = Math.round(event.target.valueAsNumber * 1000)
                model.edit((previous) => ({ ...previous, maxDurationMs }))
              }}
            />
          </div>
        </div>
      </fieldset>
      {model.historical && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('hiveWorkflow.historical')}
        </p>
      )}
      <HiveWorkflowGraph
        stages={draft.stages}
        selected={selectedStage?.stageRef ?? null}
        disabled={model.busy}
        onSelect={setSelected}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="hive-workflow-add-role">{t('hiveWorkflow.addRole')}</Label>
        <Select
          value={addingRole}
          disabled={disabled || draft.stages.length >= 32}
          onValueChange={(value) => {
            const role = workflowRoles.find((candidate) => candidate === value)
            if (role) {
              setAddingRole(role)
            }
          }}
        >
          <SelectTrigger id="hive-workflow-add-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {workflowRoles.map((role) => (
              <SelectItem key={role} value={role}>
                {t(`hiveWorkflow.roles.${role}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || draft.stages.length >= 32}
          onClick={() => {
            model.edit((previous) =>
              appendWorkflowStage(
                previous,
                addingRole,
                t(`hiveWorkflow.defaultCriteria.${addingRole}`)
              )
            )
          }}
        >
          <Plus />
          {t('hiveWorkflow.addStage')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t('hiveWorkflow.stageCount', { count: draft.stages.length })}
        </span>
      </div>
      {selectedStage && (
        <HiveWorkflowStageEditor
          key={selectedStage.stageRef}
          stage={selectedStage}
          stages={draft.stages}
          disabled={disabled}
          onChange={(stage) =>
            model.edit((previous) => ({
              ...previous,
              stages: previous.stages.map((item) =>
                item.stageRef === stage.stageRef ? stage : item
              )
            }))
          }
          onRemove={() =>
            model.edit((previous) => removeWorkflowStage(previous, selectedStage.stageRef))
          }
        />
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {model.dirty && (
          <Button type="button" variant="ghost" disabled={model.busy} onClick={model.discard}>
            {t('hiveWorkflow.discard')}
          </Button>
        )}
        <Button
          type="submit"
          disabled={disabled || !model.dirty || Boolean(model.refusal) || Boolean(model.incoming)}
        >
          {t('hiveWorkflow.save')}
        </Button>
      </div>
    </form>
  )
}
