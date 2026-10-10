import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createHiveTaskFacade } from './hive-task-facade'
import type { TaskExecutionCaller } from './task-execution-ports'
import type { LocalTaskRuntimeOwner } from './local-task-binding-options'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

type FacadeOptions = Parameters<typeof createHiveTaskFacade>[0]
export function createLocalTaskFacadeAssembly(options: {
  directory: string
  artifacts: FacadeOptions['artifacts']
  codeInspection: FacadeOptions['codeInspection']
  sessionInspection: FacadeOptions['sessionInspection']
  issuer: FacadeOptions['issuer']
  enforcement: FacadeOptions['enforcement']
  currentAccount: FacadeOptions['currentAccount']
  currentRuntime(): LocalTaskRuntimeOwner | null
  assertCurrent(): void
  resolveWorkspaceSource(selector: string): Promise<{ path: string; assertCurrent(): void }>
}) {
  const service = createHiveTaskFacade({
    descriptorPath: join(options.directory, 'paperclip.json'),
    artifacts: options.artifacts,
    codeInspection: options.codeInspection,
    sessionInspection: options.sessionInspection,
    issuer: options.issuer,
    enforcement: options.enforcement,
    currentAccount: options.currentAccount,
    assertCurrent: options.assertCurrent,
    validateWorkspace: async (selector) => {
      const source = await options.resolveWorkspaceSource(selector)
      return {
        workspaceRef: `workspace:${createHash('sha256').update(JSON.stringify(source.path)).digest('hex')}`,
        assertCurrent: source.assertCurrent
      }
    }
  })
  const prepare = async (value: unknown, caller: TaskExecutionCaller, kind: 'case' | 'plan') => {
    const observedAccount = options.currentAccount(),
      observedOwner = options.currentRuntime()
    const account = observedAccount ? { ...observedAccount } : null,
      owner = observedOwner ? { ...observedOwner } : null
    const assertCurrent = () => {
      assertTaskAuthorizationCurrent(() => caller.assertCurrent?.())
      assertTaskAuthorizationCurrent(options.assertCurrent)
      const current = options.currentAccount(),
        runtime = options.currentRuntime()
      if (
        caller.operationCallerKey !== 'trusted-local:runtime' ||
        !account ||
        !owner ||
        !current ||
        !runtime ||
        account.accountId !== owner.accountId ||
        current.sessionExpiresAt <= Date.now() ||
        current.accountId !== account.accountId ||
        current.authorityId !== account.authorityId ||
        current.sessionGeneration !== account.sessionGeneration ||
        runtime.accountId !== owner.accountId ||
        runtime.runtimeRecordId !== owner.runtimeRecordId ||
        runtime.ownershipEpoch !== owner.ownershipEpoch
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    assertCurrent()
    const refs = await (kind === 'case' ? service.prepareCaseRun : service.preparePlanRun)(
      value,
      assertCurrent
    )
    assertCurrent()
    return refs
  }
  return {
    facade: service.facade,
    prepareCaseRun: (value: unknown, caller: TaskExecutionCaller) => prepare(value, caller, 'case'),
    preparePlanRun: (value: unknown, caller: TaskExecutionCaller) => prepare(value, caller, 'plan')
  }
}
