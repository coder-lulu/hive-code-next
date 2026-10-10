import { z } from 'zod'
import { dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { createLocalTaskRequest } from './local-task-http-client'
import { readTaskArtifactFile } from './task-artifact-index'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { HIVE_WORKFLOW_PAGE_STRUCTURAL_TOKENS } from '../../shared/hive-task-workflows'
import {
  HIVE_WORKFLOW_CASE_RESPONSE_BYTES_BY_PATH,
  HIVE_WORKFLOW_CASE_RESPONSE_TOKENS_BY_PATH
} from '../../shared/hive-workflow-case-response-budget'
import {
  HIVE_WORKFLOW_PLAN_RESPONSE_BYTES_BY_PATH,
  HIVE_WORKFLOW_PLAN_RESPONSE_TOKENS_BY_PATH
} from '../../shared/hive-workflow-plan-response-budget'

export function createHiveTaskServiceContext(options: {
  descriptorPath: string
  currentAccount(): HiveRuntimeCloudAuthorization | null
  assertCurrent(): void
  request?: typeof createLocalTaskRequest
}) {
  return async () => {
    assertTaskAuthorizationCurrent(() => options.assertCurrent())
    const account = options.currentAccount()
    if (!account || account.sessionExpiresAt <= Date.now()) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const assertCurrent = (): void => {
      assertTaskAuthorizationCurrent(() => options.assertCurrent())
      const current = options.currentAccount()
      if (
        !current ||
        current.accountId !== account.accountId ||
        current.authorityId !== account.authorityId ||
        current.sessionGeneration !== account.sessionGeneration ||
        current.sessionExpiresAt <= Date.now()
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    let descriptor: { baseUrl: string; secret: string }
    try {
      const data = await readTaskArtifactFile(
        dirname(options.descriptorPath),
        basename(options.descriptorPath),
        2048
      )
      descriptor = z
        .strictObject({ baseUrl: z.string(), secret: z.string() })
        .parse(JSON.parse(data.toString('utf8')))
    } catch {
      return refuseTaskExecution('SERVICE_UNAVAILABLE')
    }
    assertCurrent()
    const request = (options.request ?? createLocalTaskRequest)({
      ...descriptor,
      headers: { 'X-Hive-Account-Id': account.accountId },
      maximumResponseBytes: 512 * 1024,
      maximumResponseBytesByPath: {
        ...HIVE_WORKFLOW_CASE_RESPONSE_BYTES_BY_PATH,
        ...HIVE_WORKFLOW_PLAN_RESPONSE_BYTES_BY_PATH,
        '/hive/workbench/cases/start': 1024 * 1024,
        '/hive/workbench/cases/run-read': 1024 * 1024
      },
      maximumResponseStructuralTokensByPath: {
        ...HIVE_WORKFLOW_CASE_RESPONSE_TOKENS_BY_PATH,
        ...HIVE_WORKFLOW_PLAN_RESPONSE_TOKENS_BY_PATH,
        '/hive/workbench/workflows/list': HIVE_WORKFLOW_PAGE_STRUCTURAL_TOKENS
      }
    })
    return {
      accountId: account.accountId,
      accountRef: `account:${createHash('sha256').update(JSON.stringify(account.accountId)).digest('hex')}`,
      assertCurrent,
      request: async (path: string, body?: unknown) => {
        assertCurrent()
        const value = await request(path, body)
        assertCurrent()
        return value
      }
    }
  }
}
export type HiveTaskServiceContext = Awaited<
  ReturnType<ReturnType<typeof createHiveTaskServiceContext>>
>
