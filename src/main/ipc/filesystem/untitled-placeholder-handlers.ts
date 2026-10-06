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
import { requireSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { resolveDesktopAuthorizedPath } from '../local-file-access-resolution'
import type { FilesystemHandlerContext } from './filesystem-handler-context'
import type { IFilesystemProvider } from '../../providers/types'
import { rethrowWithUserMessage } from '../filesystem-create-path-guards'

type PlaceholderArgs = { filePath: string; connectionId?: string } & SshMutationExpectation

export function registerUntitledPlaceholderHandlers({ store }: FilesystemHandlerContext): void {
  const host = createUntitledPlaceholderRetentionHost({
    resolveRetentionRoot: resolveUntitledPlaceholderRetentionRoot
  })
  const owners = new Set<number>()
  const remoteLeases = new Map<number, Map<string, IFilesystemProvider>>()
  const ownerKey = (event: IpcMainInvokeEvent): string => `desktop:${event.sender.id}`
  const watchOwner = (event: IpcMainInvokeEvent): void => {
    if (owners.has(event.sender.id)) {
      return
    }
    owners.add(event.sender.id)
    event.sender.once('destroyed', () => {
      owners.delete(event.sender.id)
      const remote = remoteLeases.get(event.sender.id)
      remoteLeases.delete(event.sender.id)
      for (const [token, provider] of remote ?? []) {
        void provider.releaseUntitledPlaceholder?.(ownerKey(event), token).catch((error) => {
          console.warn('Failed to release remote untitled placeholder lease', error)
        })
      }
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
    return args.connectionId
      ? { provider: requireSshFilesystemProvider(args.connectionId), filePath: args.filePath }
      : {
          provider: null,
          filePath: await resolveDesktopAuthorizedPath(args.filePath, store, {
            preserveSymlink: true
          })
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
      current.provider !== target.provider ||
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
    if (target.provider) {
      if (!target.provider.createUntitledPlaceholder) {
        await target.provider.createFile(target.filePath)
        await assertCurrent(event, args, target)
        return null
      }
      const token = await target.provider.createUntitledPlaceholder(target.filePath, owner)
      try {
        await assertCurrent(event, args, target)
      } catch (error) {
        if (token) {
          await target.provider.releaseUntitledPlaceholder?.(owner, token)
        }
        throw error
      }
      if (token) {
        let leases = remoteLeases.get(event.sender.id)
        if (!leases) {
          remoteLeases.set(event.sender.id, (leases = new Map()))
        }
        leases.set(token, target.provider)
      }
      return token
    }
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
      if (target.provider) {
        return target.provider.discardUntitledPlaceholder
          ? target.provider.discardUntitledPlaceholder(target.filePath, owner, args.leaseToken)
          : { status: 'unavailable' as const, reason: 'host-capability-unavailable' }
      }
      return host.discard(target.filePath, owner, args.leaseToken)
    }
  )

  ipcMain.handle(
    'fs:releaseUntitledPlaceholder',
    async (event, args: PlaceholderArgs & { leaseToken: string }) => {
      const target = await resolve(args)
      const owner = ownerKey(event)
      if (target.provider) {
        await target.provider.releaseUntitledPlaceholder?.(owner, args.leaseToken)
        remoteLeases.get(event.sender.id)?.delete(args.leaseToken)
      } else {
        await host.release(owner, args.leaseToken)
      }
    }
  )
}
