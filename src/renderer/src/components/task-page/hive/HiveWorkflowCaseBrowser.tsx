import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { HiveWorkflowCaseSummary } from '../../../../../shared/hive-workflow-cases'

const boardGroups = ['product', 'developer', 'tester', 'ops', 'done', 'cancelled'] as const

function CaseEntry({
  item,
  selected,
  disabled,
  onSelect
}: {
  item: HiveWorkflowCaseSummary
  selected: boolean
  disabled: boolean
  onSelect: (caseId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      aria-pressed={selected}
      data-current={selected ? 'true' : undefined}
      data-workflow-case-id={item.id}
      className="h-auto w-full min-w-0 justify-start whitespace-normal text-left"
      onClick={() => onSelect(item.id)}
    >
      <span className="min-w-0 space-y-1">
        <span className="block break-words text-sm font-medium">{item.title}</span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-normal text-muted-foreground">
          <span>
            {t('hiveWorkflowCases.browser.workflowVersion', {
              revision: item.binding.workflowRevision
            })}
          </span>
          <span>{t(`hiveWorkflowCases.caseStatuses.${item.terminalKind ?? 'open'}`)}</span>
          <span>
            {t('hiveWorkflowCases.currentStage', {
              stage: item.currentStageRole
                ? t(`hiveWorkflow.roles.${item.currentStageRole}`)
                : t('hiveWorkflowCases.browser.noCurrentStage')
            })}
          </span>
        </span>
      </span>
    </Button>
  )
}

export function HiveWorkflowCaseBrowser({
  items,
  selectedId,
  disabled,
  hasMore,
  onSelect,
  onLoadMore
}: {
  items: HiveWorkflowCaseSummary[]
  selectedId: string | null
  disabled: boolean
  hasMore: boolean
  onSelect: (caseId: string) => void
  onLoadMore: () => void
}) {
  const { t } = useTranslation()
  const entry = (item: HiveWorkflowCaseSummary) => (
    <li key={item.id} className={cn('min-w-0 rounded-md', item.id === selectedId && 'bg-accent')}>
      <CaseEntry
        item={item}
        selected={item.id === selectedId}
        disabled={disabled}
        onSelect={onSelect}
      />
    </li>
  )
  return (
    <div className="min-w-0 space-y-3" data-workflow-case-browser>
      <Tabs defaultValue="list" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label={t('hiveWorkflowCases.browser.views')}>
            <TabsTrigger value="list" disabled={disabled}>
              {t('hiveWorkflowCases.browser.list')}
            </TabsTrigger>
            <TabsTrigger value="board" disabled={disabled}>
              {t('hiveWorkflowCases.browser.board')}
            </TabsTrigger>
          </TabsList>
          <p className="text-xs text-muted-foreground">
            {t('hiveWorkflowCases.browser.loadedCount', { count: items.length })}
          </p>
        </div>
        <TabsContent value="list">
          <ul aria-label={t('hiveWorkflowCases.browser.list')} className="divide-y divide-border">
            {items.map(entry)}
          </ul>
        </TabsContent>
        <TabsContent value="board">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('hiveWorkflowCases.browser.boardHelp')}
            </p>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {boardGroups.map((group) => {
                const grouped = items.filter(
                  (item) => (item.terminalKind ?? item.currentStageRole) === group
                )
                const label = t(
                  group === 'done' || group === 'cancelled'
                    ? `hiveWorkflowCases.caseStatuses.${group}`
                    : `hiveWorkflow.roles.${group}`
                )
                return (
                  <section
                    key={group}
                    aria-label={label}
                    data-workflow-case-group={group}
                    className="min-w-0 rounded-md border border-border bg-card text-card-foreground"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                      <h4 className="text-sm font-medium">{label}</h4>
                      <span className="text-xs text-muted-foreground">
                        {t('hiveWorkflowCases.browser.loadedCount', { count: grouped.length })}
                      </span>
                    </div>
                    <ul aria-label={label} className="divide-y divide-border">
                      {grouped.map(entry)}
                    </ul>
                  </section>
                )
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>
      {hasMore && (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onLoadMore}>
          {t('hiveWorkflowCases.loadMore')}
        </Button>
      )}
    </div>
  )
}
