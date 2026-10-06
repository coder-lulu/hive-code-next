import type { UntitledPlaceholderDiscardResult } from '../../../shared/untitled-placeholder-retention-types'
import {
  untitledPlaceholderLeaseTokenSchema,
  untitledPlaceholderDiscardResultSchema
} from '../../../shared/untitled-placeholder-wire-contract'
import type { RuntimeFileOperationArgs } from './runtime-file-client-types'
import { RuntimeRpcCallError } from './runtime-rpc-client'
import {
  assertLocalFilesystemFallbackAllowed,
  getRemoteFileArgs,
  withSshMutationExpectation
} from './runtime-file-routing'
import { callRuntimeFileMutation } from './runtime-file-mutation-rpc'
import { createRuntimePath } from './runtime-file-mutation-client'

export async function createRuntimeUntitledPlaceholder(
  context: RuntimeFileOperationArgs,
  filePath: string
): Promise<string | null> {
  const remote = getRemoteFileArgs(context, filePath)
  if (!remote) {
    assertLocalFilesystemFallbackAllowed(context)
    if (window.api.fs.createUntitledPlaceholder) {
      return untitledPlaceholderLeaseTokenSchema.parse(
        await window.api.fs.createUntitledPlaceholder(
          withSshMutationExpectation(context, { filePath, connectionId: context.connectionId })
        )
      )
    }
  } else {
    try {
      return untitledPlaceholderLeaseTokenSchema.parse(
        await callRuntimeFileMutation<unknown>(
          remote.target,
          'files.createUntitledPlaceholder',
          withSshMutationExpectation(context, {
            worktree: remote.worktreeSelector,
            relativePath: remote.relativePath
          }),
          15_000
        )
      )
    } catch (error) {
      if (!(error instanceof RuntimeRpcCallError) || error.code !== 'method_not_found') {
        throw error
      }
    }
  }
  // Older hosts can create a note; absence of an origin lease remains explicit on discard.
  await createRuntimePath(context, filePath, 'file')
  return null
}

export async function discardRuntimeUntitledPlaceholder(
  context: RuntimeFileOperationArgs,
  filePath: string,
  leaseToken: string
): Promise<UntitledPlaceholderDiscardResult> {
  const remote = getRemoteFileArgs(context, filePath)
  if (!remote) {
    assertLocalFilesystemFallbackAllowed(context)
    return window.api.fs.discardUntitledPlaceholder
      ? untitledPlaceholderDiscardResultSchema.parse(
          await window.api.fs.discardUntitledPlaceholder(
            withSshMutationExpectation(context, {
              filePath,
              leaseToken,
              connectionId: context.connectionId
            })
          )
        )
      : { status: 'unavailable', reason: 'host-capability-unavailable' }
  }
  return untitledPlaceholderDiscardResultSchema.parse(
    await callRuntimeFileMutation<unknown>(
      remote.target,
      'files.discardUntitledPlaceholder',
      withSshMutationExpectation(context, {
        worktree: remote.worktreeSelector,
        relativePath: remote.relativePath,
        leaseToken
      }),
      15_000
    )
  )
}

export async function releaseRuntimeUntitledPlaceholder(
  context: RuntimeFileOperationArgs,
  filePath: string,
  leaseToken: string
): Promise<void> {
  const remote = getRemoteFileArgs(context, filePath)
  if (!remote) {
    assertLocalFilesystemFallbackAllowed(context)
    await window.api.fs.releaseUntitledPlaceholder?.(
      withSshMutationExpectation(context, {
        filePath,
        leaseToken,
        connectionId: context.connectionId
      })
    )
    return
  }
  await callRuntimeFileMutation(
    remote.target,
    'files.releaseUntitledPlaceholder',
    withSshMutationExpectation(context, {
      worktree: remote.worktreeSelector,
      relativePath: remote.relativePath,
      leaseToken
    }),
    15_000
  )
}
