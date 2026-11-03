import type { MountAdapter } from '../recording-scenario'
import type { operationModuleLoader } from '../operation-module-loader'
import type { PrSidebarLoadDeps } from '../../../session/mobile-pr-sidebar-state'

const WORKTREE = 'repo-9::/w'
const BRANCH = 'feature'

/**
 * Phase 1 of the PR sidebar, whose recorded state is the `PrSidebarState` it resolves to.
 *
 * `PrSidebarLoadDeps` is five client-taking functions, so the load is driven directly and needs no
 * React host. The containment is what the family holds: a checks leg the reader refuses records
 * `ready` with a `checksError`, where routing it back through `failureState` takes the whole
 * sidebar to `error` and loses the PR the user opened it for.
 */
export function prSidebarMountAdapters(
  modules: ReturnType<typeof operationModuleLoader>
): Record<string, MountAdapter> {
  return {
    'session.pr-sidebar': ({ client }) => {
      const reads = modules.load<typeof import('../../../session/github-pr-rpc')>(
        'mobile/src/session/github-pr-rpc.ts'
      )
      const link = modules.load<typeof import('../../../source-control/mobile-pr-link')>(
        'mobile/src/source-control/mobile-pr-link.ts'
      )
      const sidebar = modules.load<typeof import('../../../session/mobile-pr-sidebar-state')>(
        'mobile/src/session/mobile-pr-sidebar-state.ts'
      )
      // The controller's own wiring: every dep is the product read, bound to the scripted client.
      const deps: PrSidebarLoadDeps = {
        fetchForBranch: (worktreeId, args) =>
          reads.fetchHostedReviewForBranch(client, worktreeId, args),
        fetchWorktreeGitHubPRLink: (worktreeId) =>
          link.fetchWorktreeGitHubPRLink(client, worktreeId),
        clearWorktreeReviewLink: (worktreeId, expected, isCurrent) =>
          link.clearMobileWorktreeReviewLink(client, worktreeId, expected, isCurrent),
        fetchPRForBranch: (worktreeId, args) => reads.fetchPRForBranch(client, worktreeId, args),
        fetchWorkItemDetails: (worktreeId, args) =>
          reads.fetchWorkItemDetails(client, worktreeId, args),
        fetchPRChecks: (worktreeId, args) => reads.fetchPRChecks(client, worktreeId, args)
      }
      let state: unknown = 'unloaded'
      let generation = 0
      let disposed = false
      return {
        action(name, args) {
          if (name === 'load') {
            const owner = ++generation
            const isCurrent = () => !disposed && owner === generation
            return sidebar
              .loadPrSidebarData(deps, {
                worktreeId: WORKTREE,
                branch: BRANCH,
                headSha: typeof args.headSha === 'string' ? args.headSha : null,
                isCurrent
              })
              .then((next) => {
                if (isCurrent()) {
                  state = next
                }
                return next
              })
          }
          throw new Error(`Unknown pr sidebar action: ${name}`)
        },
        state: () => state,
        dispose: () => {
          disposed = true
          generation += 1
        }
      }
    }
  }
}
