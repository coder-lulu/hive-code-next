import {
  createUntitledPlaceholderRetentionHost,
  isUntitledPlaceholderOrdinaryCreateUnavailable
} from '../../shared/untitled-placeholder-retention'
import { resolveUntitledPlaceholderRetentionRoot } from '../../shared/untitled-placeholder-recovery-directory'
import type { UntitledPlaceholderDiscardResult } from '../../shared/untitled-placeholder-retention-types'
import type { RuntimeFileCommandHost } from './runtime-file-command-host'
import type { RuntimeFileExplorerPath } from './runtime-file-command-target'
import { assertRuntimeFileMutationExpectation } from './runtime-file-commands-mobile-file-list-limit'
import { requireRuntimeFileProvider } from './runtime-file-command-target'
import { resolveAuthorizedPath } from '../ipc/filesystem-auth'
import type { IFilesystemProvider } from '../providers/types'

type PlaceholderHost = Pick<RuntimeFileCommandHost, 'getRuntimeId' | 'requireStore'> & {
  resolveFileExplorerPath(worktree: string, relativePath: string): Promise<RuntimeFileExplorerPath>
  createFileExplorerFile(
    worktree: string,
    relativePath: string,
    expectedGeneration?: number,
    expectedTargetId?: string,
    expectedHostId?: string
  ): Promise<{ ok: true }>
}

export class RuntimeUntitledPlaceholderCommands {
  constructor(private readonly host: PlaceholderHost) {}
  private readonly untitledPlaceholderRetention = createUntitledPlaceholderRetentionHost({
    resolveRetentionRoot: resolveUntitledPlaceholderRetentionRoot
  })
  private readonly untitledPlaceholderOwners = new Map<
    string,
    Map<
      string,
      {
        provider: IFilesystemProvider | null
        tokens: Set<string>
      }
    >
  >()

  private async untitledPlaceholderTarget(
    worktreeSelector: string,
    relativePath: string,
    clientId: string,
    expectedGeneration?: number,
    expectedTargetId?: string,
    expectedHostId?: string
  ) {
    const target = await this.host.resolveFileExplorerPath(worktreeSelector, relativePath)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      expectedHostId,
      expectedTargetId,
      expectedGeneration
    )
    const provider = requireRuntimeFileProvider(target)
    const path = provider
      ? target.path
      : await resolveAuthorizedPath(target.path, this.host.requireStore(), {
          preserveSymlink: true
        })
    const owner = `runtime:${this.host.getRuntimeId()}:${clientId}:${target.worktree.id}`
    return { provider, path, owner, executionHostId: target.executionHostId }
  }

  async createUntitledPlaceholder(
    worktreeSelector: string,
    relativePath: string,
    clientId: string,
    expectedGeneration?: number,
    expectedTargetId?: string,
    expectedHostId?: string
  ): Promise<string | null> {
    let owners = this.untitledPlaceholderOwners.get(clientId)
    if (!owners) {
      this.untitledPlaceholderOwners.set(clientId, (owners = new Map()))
    }
    const target = await this.untitledPlaceholderTarget(
      worktreeSelector,
      relativePath,
      clientId,
      expectedGeneration,
      expectedTargetId,
      expectedHostId
    )
    const assertCurrent = async (): Promise<void> => {
      const current = await this.untitledPlaceholderTarget(
        worktreeSelector,
        relativePath,
        clientId,
        expectedGeneration,
        expectedTargetId,
        target.executionHostId
      )
      if (
        this.untitledPlaceholderOwners.get(clientId) !== owners ||
        current.provider !== target.provider ||
        current.path !== target.path ||
        current.owner !== target.owner
      ) {
        throw new Error('The placeholder owner or file authority changed during creation')
      }
    }
    await assertCurrent()
    let record = owners.get(target.owner)
    if (record && record.provider !== target.provider) {
      const previous = record
      await Promise.all(
        [...previous.tokens].map((token) =>
          previous.provider
            ? previous.provider.releaseUntitledPlaceholder?.(target.owner, token)
            : this.untitledPlaceholderRetention.release(target.owner, token)
        )
      )
      await assertCurrent()
      record = undefined
    }
    if (!record) {
      record = { provider: target.provider, tokens: new Set() }
      owners.set(target.owner, record)
    }
    const createPlaceholder = target.provider?.createUntitledPlaceholder?.bind(target.provider)
    if (target.provider && !createPlaceholder) {
      await target.provider.createFile(target.path)
      await assertCurrent()
      return null
    }
    let token: string | null
    try {
      token = createPlaceholder
        ? await createPlaceholder(target.path, target.owner)
        : await this.untitledPlaceholderRetention.create(target.path, target.owner)
    } catch (error) {
      if (target.provider || !isUntitledPlaceholderOrdinaryCreateUnavailable(error)) {
        throw error
      }
      await assertCurrent()
      await this.host.createFileExplorerFile(
        worktreeSelector,
        relativePath,
        expectedGeneration,
        expectedTargetId,
        target.executionHostId
      )
      await assertCurrent()
      return null
    }
    try {
      await assertCurrent()
    } catch (error) {
      if (token) {
        await (target.provider
          ? target.provider.releaseUntitledPlaceholder?.(target.owner, token)
          : this.untitledPlaceholderRetention.release(target.owner, token))
      }
      throw error
    }
    if (token) {
      record.tokens.add(token)
    }
    return token
  }

  async discardUntitledPlaceholder(
    worktreeSelector: string,
    relativePath: string,
    clientId: string,
    leaseToken: string,
    expectedGeneration?: number,
    expectedTargetId?: string,
    expectedHostId?: string
  ): Promise<UntitledPlaceholderDiscardResult> {
    const target = await this.untitledPlaceholderTarget(
      worktreeSelector,
      relativePath,
      clientId,
      expectedGeneration,
      expectedTargetId,
      expectedHostId
    )
    if (target.provider) {
      return target.provider.discardUntitledPlaceholder
        ? target.provider.discardUntitledPlaceholder(target.path, target.owner, leaseToken)
        : { status: 'unavailable', reason: 'host-capability-unavailable' }
    }
    return this.untitledPlaceholderRetention.discard(target.path, target.owner, leaseToken)
  }

  async releaseUntitledPlaceholder(
    worktreeSelector: string,
    relativePath: string,
    clientId: string,
    leaseToken: string,
    expectedGeneration?: number,
    expectedTargetId?: string,
    expectedHostId?: string
  ): Promise<void> {
    const target = await this.untitledPlaceholderTarget(
      worktreeSelector,
      relativePath,
      clientId,
      expectedGeneration,
      expectedTargetId,
      expectedHostId
    )
    await (target.provider
      ? target.provider.releaseUntitledPlaceholder?.(target.owner, leaseToken)
      : this.untitledPlaceholderRetention.release(target.owner, leaseToken))
    this.untitledPlaceholderOwners.get(clientId)?.get(target.owner)?.tokens.delete(leaseToken)
  }

  releaseUntitledPlaceholdersForClient(clientId: string): void {
    const owners = this.untitledPlaceholderOwners.get(clientId)
    if (!owners) {
      return
    }
    this.untitledPlaceholderOwners.delete(clientId)
    for (const [owner, record] of owners) {
      const release = record.provider
        ? Promise.all(
            [...record.tokens].map((token) =>
              record.provider?.releaseUntitledPlaceholder?.(owner, token)
            )
          )
        : this.untitledPlaceholderRetention.releaseOwner(owner)
      void release.catch((error) => {
        console.warn('Failed to release runtime untitled placeholder leases', error)
      })
    }
  }
}
