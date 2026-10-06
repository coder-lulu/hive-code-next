import { useTranslation } from 'react-i18next'
import { Loader2, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDelayedStatus } from '@/hooks/use-delayed-status'
import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import type { HiveWorkflowSnapshot } from '../../../../../shared/hive-task-workflows'
import { HiveWorkbenchPicker } from './HiveWorkbenchPicker'
import { useHiveWorkflowCases } from './use-hive-workflow-cases'
import { HiveWorkflowCaseCreateForm } from './HiveWorkflowCaseCreateForm'
import { HiveWorkflowCaseDetail } from './HiveWorkflowCaseDetail'
import { useHiveWorkflowCaseRuns } from './use-hive-workflow-case-runs'

function caseErrorKey(error: string) {
  const key = error.includes('FORBIDDEN')
    ? 'forbidden'
    : error.includes('CONFLICT')
      ? 'conflict'
      : error.includes('REQUEST_TOO_LARGE')
        ? 'tooLarge'
        : error.includes('INVALID_REQUEST')
          ? 'invalid'
          : error.includes('INVALID_RESPONSE')
            ? 'invalidResponse'
            : error.includes('CAPABILITY_UNAVAILABLE')
              ? 'clientUnavailable'
              : 'unavailable'
  return `hiveWorkflowCases.errors.${key}`
}
export function HiveWorkflowCasesSection({
  team,
  workflow,
  submissionBlocked = false
}: {
  team: HiveWorkbenchTeam
  workflow: HiveWorkflowSnapshot
  submissionBlocked?: boolean
}) {
  const { t } = useTranslation()
  const model = useHiveWorkflowCases(team, workflow, submissionBlocked)
  const runs = useHiveWorkflowCaseRuns(model.view, model.accountAvailable, model.select, model.busy)
  const pending = useDelayedStatus(`${team.project.id}:${workflow.workflowId}`, model.pending, 200)
  const error =
    model.error ??
    (model.draft && (model.draft.title || model.draft.requirement) ? model.refusal : null)
  if (!model.accountAvailable) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('hiveWorkflowCases.errors.forbidden')}
      </p>
    )
  }
  return (
    <section
      className="space-y-3 border-y border-border py-4"
      aria-labelledby="hive-workflow-cases-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id="hive-workflow-cases-heading" className="text-sm font-medium">
            {t('hiveWorkflowCases.title')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('hiveWorkflowCases.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={model.busy || runs.busy}
            onClick={() => {
              void model.refresh()
            }}
          >
            <RefreshCw />
            {t('hiveWorkflowCases.refresh')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={model.busy || runs.busy || !model.canCreate || Boolean(model.draft)}
            onClick={model.begin}
          >
            <Plus />
            {t('hiveWorkflowCases.newRequirement')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('hiveWorkflowCases.usingVersion', {
          name: workflow.name,
          revision: workflow.definition.workflowRevision
        })}
      </p>
      {!model.canCreate && (
        <p role="status" className="text-xs text-muted-foreground">
          {t(
            team.employees.length !== 4
              ? 'hiveWorkflowCases.teamNotConfigured'
              : 'hiveWorkflowCases.definitionNotReady'
          )}
        </p>
      )}
      <div
        className="flex h-6 items-center gap-2 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {pending && (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t(`hiveWorkflowCases.pending.${pending}`)}</span>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {t(caseErrorKey(error))}
        </p>
      )}
      {model.draft && <HiveWorkflowCaseCreateForm draft={model.draft} model={model} />}
      {model.items.length > 0 && (
        <HiveWorkbenchPicker
          id="hive-workflow-case-picker"
          label={t('hiveWorkflowCases.chooseCase')}
          placeholder={t('hiveWorkflowCases.chooseCase')}
          items={model.items.map((item) => ({
            id: item.id,
            name: t('hiveWorkflowCases.caseLabel', {
              title: item.title,
              revision: item.binding.workflowRevision,
              state: t(`hiveWorkflowCases.caseStatuses.${item.terminalKind ?? 'open'}`)
            })
          }))}
          value={model.view?.id ?? null}
          disabled={model.busy || runs.busy}
          hasMore={Boolean(model.nextCursor)}
          onLoadMore={() => {
            void model.loadMore()
          }}
          onValueChange={(caseId) => {
            void model.select(caseId)
          }}
        />
      )}
      {!model.items.length && !model.busy && !model.error && (
        <p className="text-sm text-muted-foreground">{t('hiveWorkflowCases.empty')}</p>
      )}
      {model.view && (
        <HiveWorkflowCaseDetail
          view={model.view}
          runs={runs}
          scopeLabel={`${team.company.name} / ${team.project.name}`}
        />
      )}
      {!model.view && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('hiveWorkflowCases.executionUnavailable')}
        </p>
      )}
    </section>
  )
}
