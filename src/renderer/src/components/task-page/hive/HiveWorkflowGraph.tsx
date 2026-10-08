import { useId, useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, CornerUpLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { WorkflowStage } from './hive-workflow-draft'
import { workflowGraphTopology } from './hive-workflow-graph-topology'
import { workflowGraphChannels, workflowGraphConnections } from './hive-workflow-graph-connections'
import { useHiveWorkflowGraphMeasurement } from './use-hive-workflow-graph-measurement'

type CaseStageTask = HiveWorkflowCaseView['stageTasks'][number]
export type HiveWorkflowGraphCaseFacts = {
  currentStageRef: string | null
  stageTasks: readonly Pick<CaseStageTask, 'stageRef' | 'status'>[]
}

export function HiveWorkflowGraph({
  stages,
  selected,
  disabled,
  onSelect,
  caseFacts
}: {
  stages: readonly WorkflowStage[]
  selected: string | null
  disabled: boolean
  onSelect: (stageRef: string) => void
  caseFacts?: HiveWorkflowGraphCaseFacts
}) {
  const { t } = useTranslation()
  const arrowId = useId()
  const topology = useMemo(() => workflowGraphTopology(stages), [stages])
  const channels = useMemo(() => workflowGraphChannels(topology), [topology])
  const measured = useHiveWorkflowGraphMeasurement(topology)
  const connections = measured.measurement
    ? workflowGraphConnections(topology, measured.measurement)
    : []
  const Heading = caseFacts ? 'h4' : 'h3'
  const style: CSSProperties & Record<`--workflow-${string}`, number> = {
    '--workflow-layer-count': Math.max(1, topology.layers),
    '--workflow-forward-channels': channels.forward.length,
    '--workflow-return-channels': channels.returns.length,
    '--workflow-dependency-channels': channels.sources.length
  }
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
    <div className="space-y-2" data-workflow-graph>
      <Heading className="text-sm font-medium">{t('hiveWorkflow.flowView')}</Heading>
      <p className="text-xs text-muted-foreground">{t('hiveWorkflow.graphLegend')}</p>
      {topology.invalid && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('hiveWorkflow.graphInvalidLayout')}
        </p>
      )}
      <div
        ref={measured.canvas}
        className="hive-workflow-graph-canvas"
        data-orientation={measured.orientation}
        data-workflow-graph-valid={!topology.invalid}
        style={style}
      >
        <span
          ref={measured.nodeWidth}
          className="hive-workflow-graph-width-probe"
          aria-hidden="true"
        />
        <span ref={measured.gaps} className="hive-workflow-graph-gap-probe" aria-hidden="true" />
        {measured.measurement && (
          <svg
            data-workflow-graph-edges
            aria-hidden="true"
            className="hive-workflow-graph-connections"
            viewBox={`0 0 ${measured.measurement.width} ${measured.measurement.height}`}
          >
            <defs>
              <marker
                id={arrowId}
                viewBox="0 0 1 1"
                refX="1"
                refY="0.5"
                orient="auto"
                markerUnits="userSpaceOnUse"
                markerWidth={measured.measurement.laneGap / 2}
                markerHeight={measured.measurement.laneGap / 2}
              >
                <path d="M 0 0 L 1 0.5 L 0 1 Z" fill="currentColor" />
              </marker>
            </defs>
            {connections.map((edge) => (
              <path
                key={edge.key}
                data-workflow-edge-kind={edge.kind}
                d={edge.d}
                fill="none"
                stroke="currentColor"
                strokeWidth={measured.measurement!.laneGap / 6}
                strokeLinejoin="round"
                strokeLinecap="round"
                markerEnd={`url(#${arrowId})`}
                strokeDasharray={
                  edge.kind === 'return'
                    ? `${measured.measurement!.laneGap / 3} ${measured.measurement!.laneGap / 6}`
                    : undefined
                }
              />
            ))}
          </svg>
        )}
        <ol
          ref={measured.nodes}
          aria-label={t('hiveWorkflow.flowView')}
          className="hive-workflow-graph-nodes"
        >
          {topology.nodes.map((node) => {
            const { stage } = node
            const task = caseFacts?.stageTasks.find((item) => item.stageRef === stage.stageRef)
            const current = caseFacts?.currentStageRef === stage.stageRef
            return (
              <li
                key={node.key}
                data-workflow-node-key={node.key}
                data-workflow-stage-ref={stage.stageRef}
                data-workflow-stage-task={task ? '' : undefined}
                data-current={selected === stage.stageRef ? 'true' : undefined}
                className={cn(
                  'hive-workflow-graph-node space-y-2 rounded-md border border-border py-2',
                  selected === stage.stageRef
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-card text-card-foreground'
                )}
                style={
                  measured.orientation === 'horizontal'
                    ? { gridColumn: node.layer + 1, gridRow: node.row + 1 }
                    : undefined
                }
              >
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-pressed={selected === stage.stageRef}
                  aria-current={current ? 'step' : undefined}
                  className="h-auto w-full justify-start break-words whitespace-normal text-left"
                  onClick={() => onSelect(stage.stageRef)}
                >
                  {t('hiveWorkflow.stageLabel', {
                    index: node.sourceIndex + 1,
                    role: t(`hiveWorkflow.roles.${stage.role}`)
                  })}
                </Button>
                <div className="space-y-1 px-3 text-xs text-muted-foreground">
                  {caseFacts && (
                    <p data-workflow-business-status={task?.status}>
                      {task
                        ? t('hiveWorkflowCases.graph.businessStatus', {
                            status: t(`hiveWorkflowCases.statuses.${task.status}`)
                          })
                        : t('hiveWorkflowCases.graph.statusUnavailable')}
                    </p>
                  )}
                  {current && (
                    <p data-workflow-current-stage>{t('hiveWorkflowCases.graph.currentStage')}</p>
                  )}
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
            )
          })}
        </ol>
      </div>
    </div>
  )
}
