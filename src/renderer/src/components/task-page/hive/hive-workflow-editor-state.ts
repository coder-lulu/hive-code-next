import type { HiveWorkflowSnapshot } from '../../../../../shared/hive-task-workflows'
import type { HiveWorkflowDraft } from './hive-workflow-draft'

export type HiveWorkflowState = {
  items: HiveWorkflowSnapshot[]
  nextCursor: string | null
  baseline: HiveWorkflowSnapshot | null
  incoming: HiveWorkflowSnapshot | null
  draft: HiveWorkflowDraft | null
  pending: 'list' | 'read' | 'save' | null
  error: string | null
}
export type HiveWorkflowAct = <T>(
  pending: NonNullable<HiveWorkflowState['pending']>,
  operation: () => Promise<T>,
  receive: (value: T) => void
) => Promise<boolean>
export const emptyWorkflowState = (): HiveWorkflowState => ({
  items: [],
  nextCursor: null,
  baseline: null,
  incoming: null,
  draft: null,
  pending: null,
  error: null
})
