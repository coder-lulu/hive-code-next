import type {
  PRCheckAnnotation,
  PRCheckJob,
  PRCheckRunDetails,
  PRCheckStep
} from '../../../../src/shared/github/check-types'

// Pure mapping from the github.prCheckDetails payload to the rows the mobile
// expanded check detail renders. No React/native imports so it stays unit-testable
// under the node Vitest config (KTD5). Ports the desktop CheckDetailExpanded logic
// (conclusion/title/summary + annotations + failed-job/step summary), not its JSX.

// Desktop caps the inline lists so a noisy check can't break the layout; match it.
const MAX_ANNOTATIONS = 20
const MAX_JOBS = 100

const CHECK_STATE_LABELS: Readonly<Record<string, string>> = {
  success: '成功',
  failure: '失败',
  failed: '失败',
  pending: '等待中',
  queued: '排队中',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
  timed_out: '已超时',
  skipped: '已跳过',
  neutral: '中性',
  action_required: '需要操作',
  warning: '警告',
  notice: '提示'
}

function checkStateLabel(state: string | null | undefined): string {
  return state ? (CHECK_STATE_LABELS[state] ?? state) : '未知'
}

function isFailureState(state: string | null | undefined): boolean {
  return state === 'failure' || state === 'failed' || state === 'cancelled' || state === 'timed_out'
}

export type CheckDetailAnnotation = {
  // Path:line locator (or "Annotation" when the host omits a path).
  locator: string
  level: string | null
  title: string | null
  message: string
}

export type CheckDetailStep = {
  name: string
  state: string
}

export type CheckDetailJob = {
  name: string
  state: string
  // Failed steps within the job; empty when none reported as failing.
  failedSteps: CheckDetailStep[]
  logTail: string | null
}

export type CheckDetailContent = {
  // Conclusion/title/summary lines, in render order (matches the prior mobile detail).
  summaryLines: string[]
  annotations: CheckDetailAnnotation[]
  // True when the host returned more annotations than we render.
  annotationsTruncated: boolean
  // "Failed jobs" when only failing jobs are shown, else "Jobs" (matches desktop label).
  jobsLabel: '失败的任务' | '任务'
  jobs: CheckDetailJob[]
  jobsTruncated: boolean
}

function mapAnnotation(annotation: PRCheckAnnotation): CheckDetailAnnotation {
  const path = annotation.path ?? '注解'
  const locator = annotation.startLine ? `${path}:${annotation.startLine}` : path
  return {
    locator,
    level: annotation.annotationLevel ? checkStateLabel(annotation.annotationLevel) : null,
    title: annotation.title,
    message: annotation.message
  }
}

function mapJob(job: PRCheckJob): CheckDetailJob {
  const failedSteps = job.steps
    .filter((step: PRCheckStep) => isFailureState(step.conclusion ?? step.status))
    .map((step) => ({ name: step.name, state: checkStateLabel(step.conclusion ?? step.status) }))
  return {
    name: job.name,
    state: checkStateLabel(job.conclusion ?? job.status),
    failedSteps,
    logTail: job.logTail
  }
}

export function presentCheckDetail(details: PRCheckRunDetails): CheckDetailContent {
  const summaryLines = [
    checkStateLabel(details.conclusion ?? details.status),
    details.title,
    details.summary
  ].filter((line): line is string => typeof line === 'string' && line.trim().length > 0)

  // Why: prefer failing jobs (the actionable ones); fall back to all jobs only
  // when nothing is failing, matching the desktop panel.
  const failedJobs = details.jobs.filter((job) => isFailureState(job.conclusion ?? job.status))
  const visibleJobs = failedJobs.length > 0 ? failedJobs : details.jobs

  return {
    summaryLines,
    annotations: details.annotations.slice(0, MAX_ANNOTATIONS).map(mapAnnotation),
    annotationsTruncated: details.annotations.length > MAX_ANNOTATIONS,
    jobsLabel: failedJobs.length > 0 ? '失败的任务' : '任务',
    jobs: visibleJobs.slice(0, MAX_JOBS).map(mapJob),
    jobsTruncated: details.jobs.length > MAX_JOBS
  }
}
