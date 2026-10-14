import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { writeFile } from 'node:fs/promises'
import {
  createUntitledPlaceholderRetentionHost,
  isUntitledPlaceholderOrdinaryCreateUnavailable
} from '../../../shared/untitled-placeholder-retention'
import { resolveUntitledPlaceholderRetentionRoot } from '../../../shared/untitled-placeholder-recovery-directory'
import type { SshMutationExpectation } from '../../../shared/ssh-types'
import { assertSshMutationExpectation } from '../../ssh/ssh-connection-generation'
import { SshHostNotServedError } from '../../providers/ssh-host-not-served-error'
import { resolveDesktopAuthorizedPath } from '../local-file-access-resolution'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import { rethrowWithUserMessage } from '../filesystem-create-path-guards'

type PlaceholderArgs = { filePath: string; connectionId?: string } & SshMutationExpectation

export function registerUntitledPlaceholderHandlers({ store }: FilesystemHandlerContext): void {
  const host = createUntitledPlaceholderRetentionHost({
    resolveRetentionRoot: resolveUntitledPlaceholderRetentionRoot
  })
  const owners = new Set<number>()
  const ownerKey = (event: IpcMainInvokeEvent): string => `desktop:${event.sender.id}`
  const watchOwner = (event: IpcMainInvokeEvent): void => {
    if (owners.has(event.sender.id)) {
      return
    }
    owners.add(event.sender.id)
    event.sender.once('destroyed', () => {
      owners.delete(event.sender.id)
      void host.releaseOwner(ownerKey(event)).catch((error) => {
        console.warn('Failed to release untitled placeholder leases', error)
      })
    })
  }
  const resolve = async (args: PlaceholderArgs) => {
    assertSshMutationExpectation(
      args.connectionId,
      args.expectedSshTargetId,
      args.expectedSshConnectionGeneration,
      args.expectedExecutionHostId
    )
    if (args.connectionId) {
      throw new SshHostNotServedError(args.connectionId)
    }
    return {
      filePath: await resolveDesktopAuthorizedPath(args.filePath, store, { preserveSymlink: true })
    }
  }
  const assertCurrent = async (
    event: IpcMainInvokeEvent,
    args: PlaceholderArgs,
    target: Awaited<ReturnType<typeof resolve>>
  ): Promise<void> => {
    const current = await resolve(args)
    if (
      event.sender.isDestroyed() ||
      current.filePath !== target.filePath
    ) {
      throw new Error('Editor owner or file authority changed during file creation')
    }
  }

  ipcMain.handle('fs:createUntitledPlaceholder', async (event, args: PlaceholderArgs) => {
    const target = await resolve(args)
    const owner = ownerKey(event)
    if (event.sender.isDestroyed()) {
      throw new Error('Editor owner is unavailable')
    }
    watchOwner(event)
    let token: string
    try {
      token = await host.create(target.filePath, owner)
    } catch (error) {
      if (!isUntitledPlaceholderOrdinaryCreateUnavailable(error)) {
        throw error
      }
      await assertCurrent(event, args, target)
      try {
        await writeFile(target.filePath, '', { encoding: 'utf-8', flag: 'wx' })
      } catch (createError) {
        rethrowWithUserMessage(createError, target.filePath)
      }
      await assertCurrent(event, args, target)
      return null
    }
    try {
      await assertCurrent(event, args, target)
    } catch (error) {
      await host.release(owner, token)
      throw error
    }
    return token
  })

  ipcMain.handle(
    'fs:discardUntitledPlaceholder',
    async (event, args: PlaceholderArgs & { leaseToken: string }) => {
      const target = await resolve(args)
      if (event.sender.isDestroyed()) {
        throw new Error('Editor owner is unavailable')
      }
      const owner = ownerKey(event)
      return host.discard(target.filePath, owner, args.leaseToken)
    }
  )

  ipcMain.handle(
    'fs:releaseUntitledPlaceholder',
    async (event, args: PlaceholderArgs & { leaseToken: string }) => {
      await resolve(args)
      const owner = ownerKey(event)
      await host.release(owner, args.leaseToken)
    }
  )
}
