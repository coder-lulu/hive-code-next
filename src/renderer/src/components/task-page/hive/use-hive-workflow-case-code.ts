import { useCallback, useEffect, useRef, useState } from 'react'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { HiveAccountState } from '../../../../../shared/hive-account'
import type { WorkflowHandoff } from '../../../../../shared/task-workflow/workflow-evidence'
import type {
  HiveWorkflowCaseCodePage,
  HiveWorkflowCaseCodeFile,
  HiveWorkflowCaseCodePageQuery
} from '../../../../../shared/hive-workflow-case-code'
import { subscribeHiveUiAccountBoundary } from './hive-ui-account-boundary'
import { readWorkflowCodePage, readWorkflowCodeFile } from './hive-workflow-case-code-responses'

type CodeState = {
  ready: boolean
  pending: 'page' | 'file' | null
  error: string | null
  page: HiveWorkflowCaseCodePage | null
  file: HiveWorkflowCaseCodeFile | null
  pageNumber: number
}
const emptyCodeState = (): CodeState => ({
  ready: false,
  pending: null,
  error: null,
  page: null,
  file: null,
  pageNumber: 0
})
function signedIn(account: HiveAccountState) {
  return (
    account.configured &&
    account.status === 'signed-in' &&
    account.account &&
    account.errorCode !== 'session_expired' &&
    account.errorCode !== 'session_rejected' &&
    (account.sessionExpiresAt === undefined || account.sessionExpiresAt > Date.now())
  )
}

// The reader is keyed to the immutable Case/handoff selection; polling never reloads its tree.
export function useHiveWorkflowCaseCode(view: HiveWorkflowCaseView, handoff: WorkflowHandoff) {
  const [state, setState] = useState(emptyCodeState)
  const mounted = useRef(false)
  const ready = useRef(false)
  const revoked = useRef(false)
  const generation = useRef(0)
  const flight = useRef<object | null>(null)
  const selected = useRef({ view, handoff })
  const currentPage = useRef<HiveWorkflowCaseCodePage | null>(null)
  useEffect(() => {
    mounted.current = true
    let expiry: ReturnType<typeof setTimeout> | undefined
    let accountEvents = 0
    let observedDeadline: number | undefined
    const invalidate = () => {
      if (!mounted.current) {
        return
      }
      revoked.current = true
      ready.current = false
      generation.current += 1
      flight.current = null
      currentPage.current = null
      if (expiry !== undefined) {
        clearTimeout(expiry)
        expiry = undefined
      }
      setState({ ...emptyCodeState(), error: 'FORBIDDEN' })
    }
    const observeAccount = (account: HiveAccountState) => {
      if (!mounted.current || revoked.current) {
        return
      }
      if (!signedIn(account)) {
        invalidate()
        return
      }
      ready.current = true
      setState((previous) => ({ ...previous, ready: true }))
      if (expiry !== undefined) {
        clearTimeout(expiry)
        expiry = undefined
      }
      if (account.sessionExpiresAt !== undefined) {
        observedDeadline = account.sessionExpiresAt
      }
      const armExpiry = () => {
        if (observedDeadline === undefined || !mounted.current || revoked.current) {
          return
        }
        const remaining = observedDeadline - Date.now()
        if (remaining <= 0) {
          invalidate()
          return
        }
        expiry = setTimeout(armExpiry, Math.min(2_147_483_647, remaining))
      }
      armExpiry()
    }
    const unsubscribe = subscribeHiveUiAccountBoundary(invalidate)
    const unsubscribeMetadata = window.api.hiveAccount.onStateChanged((account) => {
      accountEvents += 1
      observeAccount(account)
    })
    const readRevision = accountEvents
    void window.api.hiveAccount
      .getState()
      .then((account) => {
        if (accountEvents === readRevision) {
          observeAccount(account)
        }
      })
      .catch(() => {
        if (mounted.current && accountEvents === readRevision) {
          invalidate()
        }
      })
    return () => {
      unsubscribe()
      unsubscribeMetadata()
      if (expiry !== undefined) {
        clearTimeout(expiry)
      }
      mounted.current = false
      ready.current = false
      generation.current += 1
      flight.current = null
      currentPage.current = null
    }
  }, [])
  const act = useCallback(
    async <T>(
      pending: NonNullable<CodeState['pending']>,
      operation: () => Promise<T>,
      receive: (value: T) => void
    ) => {
      if (!mounted.current || !ready.current || revoked.current || flight.current) {
        return false
      }
      const token = {}
      const epoch = generation.current
      const current = () =>
        mounted.current &&
        !revoked.current &&
        generation.current === epoch &&
        flight.current === token
      flight.current = token
      setState((previous) => ({ ...previous, pending, error: null, file: null }))
      try {
        const value = await Promise.resolve().then(() => {
          if (!current()) {
            throw new Error('STALE_REQUEST')
          }
          return operation()
        })
        if (!current()) {
          return false
        }
        receive(value)
        return true
      } catch (failure) {
        if (current()) {
          currentPage.current = null
          setState((previous) => ({
            ...previous,
            page: null,
            file: null,
            error: failure instanceof Error ? failure.message : 'SERVICE_UNAVAILABLE'
          }))
        }
        return false
      } finally {
        if (current()) {
          flight.current = null
          setState((previous) => ({ ...previous, pending: null }))
        }
      }
    },
    []
  )
  const loadPage = useCallback(
    (after?: HiveWorkflowCaseCodePageQuery['after']) => {
      const { view, handoff } = selected.current
      const query = {
        projectId: view.binding.scope.projectRef,
        caseId: view.id,
        handoffRef: handoff.handoffRef,
        after,
        limit: 50
      }
      return act(
        'page',
        async () =>
          readWorkflowCodePage(
            await window.api.hiveTasks.getWorkflowCaseCodePage(query),
            query,
            handoff
          ),
        (page) => {
          currentPage.current = page
          setState((previous) => ({
            ...previous,
            page,
            pageNumber: after ? previous.pageNumber + 1 : 1
          }))
        }
      )
    },
    [act]
  )
  return {
    ...state,
    busy: state.pending !== null,
    loadPage: () => loadPage(),
    nextPage: () =>
      currentPage.current?.nextCursor
        ? loadPage(currentPage.current.nextCursor)
        : Promise.resolve(false),
    readFile: (path: string) => {
      const page = currentPage.current
      if (!page?.files.some((file) => file.path === path)) {
        return Promise.resolve(false)
      }
      const { view, handoff } = selected.current
      const query = {
        projectId: view.binding.scope.projectRef,
        caseId: view.id,
        handoffRef: handoff.handoffRef,
        path
      }
      return act(
        'file',
        async () =>
          readWorkflowCodeFile(
            await window.api.hiveTasks.getWorkflowCaseCodeFile(query),
            query,
            page,
            handoff
          ),
        (file) => {
          setState((previous) => ({ ...previous, file }))
        }
      )
    }
  }
}
