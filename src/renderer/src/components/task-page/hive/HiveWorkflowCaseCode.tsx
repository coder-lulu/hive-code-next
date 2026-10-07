import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDelayedStatus } from '@/hooks/use-delayed-status'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { WorkflowHandoff } from '../../../../../shared/task-workflow/workflow-evidence'
import { HiveWorkflowCodeVersionSchema } from '../../../../../shared/hive-workflow-case-code'
import { HiveWorkbenchPicker } from './HiveWorkbenchPicker'
import { useHiveWorkflowCaseCode } from './use-hive-workflow-case-code'
import { workflowCodeSelectionKey } from './hive-workflow-case-code-responses'

function CodeReader({ view, handoff }: { view: HiveWorkflowCaseView; handoff: WorkflowHandoff }) {
  const { t } = useTranslation()
  const model = useHiveWorkflowCaseCode(view, handoff)
  const pending = useDelayedStatus(handoff.handoffRef, model.pending, 200)
  const error = model.error?.includes('FORBIDDEN')
    ? 'forbidden'
    : model.error?.includes('INVALID_RESPONSE')
      ? 'invalidResponse'
      : 'unavailable'
  return (
    <div className="space-y-3" data-case-code-reader>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!model.ready || model.busy}
          onClick={() => {
            void model.loadPage()
          }}
        >
          {t('hiveWorkflowCases.code.loadFiles')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!model.ready || model.busy || !model.page?.nextCursor}
          onClick={() => {
            void model.nextPage()
          }}
        >
          {t('hiveWorkflowCases.code.nextPage')}
        </Button>
      </div>
      <div
        className="flex h-6 items-center gap-2 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {pending && (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t('hiveTasks.working')}</span>
          </>
        )}
      </div>
      {model.error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {t(`hiveWorkflowCases.code.errors.${error}`)}
        </p>
      )}
      {model.page && (
        <>
          <p className="text-xs text-muted-foreground">
            {t('hiveWorkflowCases.code.page', {
              number: model.pageNumber,
              count: model.page.files.length
            })}
          </p>
          {!model.page.files.length && (
            <p className="text-sm text-muted-foreground">
              {t('hiveWorkflowCases.code.emptyFiles')}
            </p>
          )}
          <ol className="divide-y divide-border">
            {model.page.files.map((file) => (
              <li key={file.path} data-code-file-row className="space-y-1 py-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-auto max-w-full justify-start break-all whitespace-normal text-left"
                  aria-pressed={model.file?.file.path === file.path}
                  disabled={model.busy}
                  onClick={() => {
                    void model.readFile(file.path)
                  }}
                >
                  {file.path}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t('hiveWorkflowCases.code.fileSize', { size: file.size })}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
      {model.file && (
        <section
          className="space-y-2 border-t border-border pt-3"
          aria-labelledby="hive-code-file-heading"
        >
          <h5 id="hive-code-file-heading" className="break-all text-sm font-medium">
            {model.file.file.path}
          </h5>
          <p className="break-all text-xs text-muted-foreground">
            {t('hiveWorkflowCases.code.fileDigest', { digest: model.file.file.digest })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('hiveWorkflowCases.code.executableBits', {
              bits: model.file.file.executableBits.toString(8)
            })}
          </p>
          {model.file.preview.kind === 'text' ? (
            <Textarea
              readOnly
              variant="code"
              rows={12}
              className="max-h-80"
              aria-label={model.file.file.path}
              value={model.file.preview.text}
            />
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t(`hiveWorkflowCases.code.previewUnavailable.${model.file.preview.reason}`)}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
function CodeSelection({
  view,
  handoffs
}: {
  view: HiveWorkflowCaseView
  handoffs: WorkflowHandoff[]
}) {
  const { t } = useTranslation()
  const [selectedRef, setSelectedRef] = useState(() => handoffs.at(-1)!.handoffRef)
  const selected = handoffs.find((handoff) => handoff.handoffRef === selectedRef)
  const supported =
    selected && HiveWorkflowCodeVersionSchema.safeParse(selected.codeVersion).success
  return (
    <div className="space-y-3">
      <Label htmlFor="hive-case-code-version">{t('hiveWorkflowCases.code.chooseVersion')}</Label>
      <HiveWorkbenchPicker
        id="hive-case-code-version"
        label={t('hiveWorkflowCases.code.chooseVersion')}
        placeholder={t('hiveWorkflowCases.code.chooseVersion')}
        value={selectedRef}
        disabled={false}
        items={handoffs.map((handoff) => ({
          id: handoff.handoffRef,
          name: t('hiveWorkflowCases.code.versionLabel', {
            attempt: handoff.producer.task.attempt,
            version: handoff.codeVersion?.treeDigest
          })
        }))}
        onValueChange={setSelectedRef}
      />
      {selected?.codeVersion && (
        <p data-code-version className="break-all text-xs text-muted-foreground">
          {t('hiveWorkflowCases.code.fixedVersion', { version: selected.codeVersion.treeDigest })}
        </p>
      )}
      {supported && selected ? (
        <CodeReader key={workflowCodeSelectionKey(selected)} view={view} handoff={selected} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t('hiveWorkflowCases.code.snapshotUnavailable')}
        </p>
      )}
    </div>
  )
}
export function HiveWorkflowCaseCode({ view }: { view: HiveWorkflowCaseView }) {
  const { t } = useTranslation()
  const handoffs = view.handoffs.filter((handoff) => handoff.producer.role === 'developer')
  const scope = JSON.stringify([
    view.id,
    view.binding,
    view.definitionDigest,
    view.projectBindingRevision
  ])
  return (
    <section
      className="space-y-3 border-t border-border pt-3"
      aria-labelledby="hive-case-code-heading"
    >
      <h4 id="hive-case-code-heading" className="text-sm font-medium">
        {t('hiveWorkflowCases.code.title')}
      </h4>
      <p className="text-xs text-muted-foreground">{t('hiveWorkflowCases.code.description')}</p>
      {handoffs.length ? (
        <CodeSelection key={scope} view={view} handoffs={handoffs} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('hiveWorkflowCases.code.empty')}</p>
      )}
    </section>
  )
}
