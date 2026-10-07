import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { isBoundedString, isRecord } from '../../shared/agent-status-child-work-value-guards'
import { normalizeCodexRuntimeSelection } from '../codex-accounts/runtime-selection'
import { resolveHostCodexManagedHomeVerdict } from '../codex-accounts/host-codex-managed-home-ownership'

export type TaskCodexAccountScopeDependencies = Readonly<{
  getSettings: () => Pick<
    GlobalSettings,
    'codexManagedAccounts' | 'activeCodexManagedAccountId' | 'activeCodexManagedAccountIdsByRuntime'
  >
  getManagedAccountsRoot: () => string
  getSystemCodexHomePath: () => string
}>

export type TaskCodexAccountScope = Readonly<{
  /** Original managed row ID, independent of the Hive account ID. */
  accountId: string
  codexHome: string
  providerAccountId: string
  assertCurrent: () => void
  /** Metadata currentness only; this port does not re-prove owned-home evidence. */
  assertMetadataCurrent: () => void
}>

const accountSettingsSchema = z.object({
  activeCodexManagedAccountId: z.string().nullable(),
  activeCodexManagedAccountIdsByRuntime: z
    .object({ host: z.string().nullable(), wsl: z.record(z.string(), z.string().nullable()) })
    .optional(),
  codexManagedAccounts: z.array(
    z.object({
      id: z.string().min(1).max(512),
      managedHomePath: z.string(),
      managedHomeRuntime: z.enum(['host', 'wsl']).optional(),
      wslDistro: z.string().nullable().optional(),
      wslLinuxHomePath: z.string().nullable().optional(),
      providerAccountId: z.string().nullable().optional()
    })
  )
})
const ownedVerdictSchema = z.strictObject({ kind: z.literal('owned'), homePath: z.string() })

function unavailable(): never {
  throw new Error('TASK_MODEL_AUTH_SCOPE_UNAVAILABLE')
}

function nativeAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    value === value.trim() &&
    !value.includes('\0') &&
    !/^[\\/]{2}/.test(value) &&
    isAbsolute(value) &&
    (process.platform !== 'win32' || /^[A-Za-z]:[\\/]/.test(value))
  )
}

export function resolveSelectedTaskCodexAccountScope(
  dependencies: TaskCodexAccountScopeDependencies
): TaskCodexAccountScope {
  try {
    const parsed = accountSettingsSchema.safeParse(dependencies.getSettings())
    if (!parsed.success) {
      return unavailable()
    }
    const selected = normalizeCodexRuntimeSelection(parsed.data).host
    const matches = parsed.data.codexManagedAccounts.filter((row) => row.id === selected)
    const row = matches[0]
    if (!row || matches.length !== 1) {
      return unavailable()
    }
    const scope = resolveTaskCodexAccountScope(dependencies, row.managedHomePath)
    if (scope.accountId !== row.id) {
      return unavailable()
    }
    return scope
  } catch {
    return unavailable()
  }
}

// Account metadata and owned-home observations do not grant model or Host authority.
export function resolveTaskCodexAccountScope(
  dependencies: TaskCodexAccountScopeDependencies,
  pinnedCodexHome: string
): TaskCodexAccountScope {
  function readMetadata() {
    try {
      if (!nativeAbsolutePath(pinnedCodexHome)) {
        return unavailable()
      }
      const parsed = accountSettingsSchema.safeParse(dependencies.getSettings())
      if (!parsed.success) {
        return unavailable()
      }
      const selected = normalizeCodexRuntimeSelection(parsed.data).host
      const matches = parsed.data.codexManagedAccounts.filter((row) => row.id === selected)
      const row = matches[0]
      if (
        !row ||
        matches.length !== 1 ||
        !isBoundedString(row.id, 512) ||
        /[\\/]/.test(row.id) ||
        row.managedHomeRuntime === 'wsl' ||
        row.wslDistro != null ||
        row.wslLinuxHomePath != null ||
        !nativeAbsolutePath(row.managedHomePath) ||
        normalizeRuntimePathForComparison(row.managedHomePath) !==
          normalizeRuntimePathForComparison(pinnedCodexHome) ||
        typeof row.providerAccountId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,256}(?![\s\S])/.test(row.providerAccountId)
      ) {
        return unavailable()
      }
      const root = dependencies.getManagedAccountsRoot()
      const systemHome = dependencies.getSystemCodexHomePath()
      if (!nativeAbsolutePath(root) || !nativeAbsolutePath(systemHome)) {
        return unavailable()
      }
      return {
        accountId: row.id,
        rowHome: row.managedHomePath,
        providerAccountId: row.providerAccountId,
        root,
        systemHome
      }
    } catch {
      return unavailable()
    }
  }
  function readOwnedHome(metadata: ReturnType<typeof readMetadata>) {
    try {
      const verdict: unknown = resolveHostCodexManagedHomeVerdict({
        candidatePath: pinnedCodexHome,
        expectedAccountId: metadata.accountId,
        managedAccountsRoot: metadata.root,
        systemCodexHomePath: metadata.systemHome
      })
      if (isRecord(verdict) && typeof verdict.then === 'function') {
        void Promise.resolve(verdict).catch(() => undefined)
        return unavailable()
      }
      const owned = ownedVerdictSchema.safeParse(verdict)
      if (!owned.success || !nativeAbsolutePath(owned.data.homePath)) {
        return unavailable()
      }
      return normalizeRuntimePathForComparison(owned.data.homePath)
    } catch {
      return unavailable()
    }
  }
  const snapshot = Object.freeze(readMetadata())
  const ownedHome = readOwnedHome(snapshot)
  function currentMetadata() {
    const current = readMetadata()
    if (
      current.accountId !== snapshot.accountId ||
      current.rowHome !== snapshot.rowHome ||
      current.providerAccountId !== snapshot.providerAccountId ||
      current.root !== snapshot.root ||
      current.systemHome !== snapshot.systemHome
    ) {
      unavailable()
    }
    return current
  }
  return Object.freeze({
    accountId: snapshot.accountId,
    codexHome: pinnedCodexHome,
    providerAccountId: snapshot.providerAccountId,
    assertCurrent: () => {
      if (readOwnedHome(currentMetadata()) !== ownedHome) {
        unavailable()
      }
    },
    assertMetadataCurrent: () => {
      currentMetadata()
    }
  })
}
