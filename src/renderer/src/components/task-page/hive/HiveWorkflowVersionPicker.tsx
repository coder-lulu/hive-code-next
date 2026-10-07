import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { HiveWorkflowSnapshot } from '../../../../../shared/hive-task-workflows'
import type { HiveWorkflowModel } from './use-hive-workflows'

export function HiveWorkflowVersionPicker({
  snapshot,
  model
}: {
  snapshot: HiveWorkflowSnapshot
  model: HiveWorkflowModel
}) {
  const { t } = useTranslation()
  const [revision, setRevision] = useState(snapshot.definition.workflowRevision)
  const latest =
    model.items.find((item) => item.workflowId === snapshot.workflowId)?.definition
      .workflowRevision ?? snapshot.definition.workflowRevision
  return (
    <div className="space-y-2">
      <Label htmlFor="hive-workflow-revision">{t('hiveWorkflow.version')}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="hive-workflow-revision"
          type="number"
          min={1}
          max={latest}
          step={1}
          className="w-24"
          value={Number.isFinite(revision) ? revision : ''}
          disabled={model.busy || model.dirty}
          onChange={(event) => setRevision(event.target.valueAsNumber)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            model.busy ||
            model.dirty ||
            !Number.isInteger(revision) ||
            revision < 1 ||
            revision > latest
          }
          onClick={() => {
            void model.select(snapshot.workflowId, revision)
          }}
        >
          {t('hiveWorkflow.loadVersion')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={model.busy || model.dirty}
          onClick={() => {
            void model.select(snapshot.workflowId)
          }}
        >
          {t('hiveWorkflow.loadLatest')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('hiveWorkflow.viewingVersion', {
          revision: snapshot.definition.workflowRevision,
          latest
        })}
      </p>
    </div>
  )
}
