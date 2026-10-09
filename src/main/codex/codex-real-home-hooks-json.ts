import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  type HooksConfig,
  buildManagedCommandHook,
  removeManagedCommands,
  type HookDefinition
} from '../agent-hooks/installer-utils'
import { resolveHooksJsonWritePath } from '../agent-hooks/hook-config-write-path'
import { getSystemCodexHomePath } from './codex-home-paths'
import { APP_DISPLAY_NAME } from '../../shared/brand'
import { isPlainObject, readHooksJsonWithRaw } from '../agent-hooks/hooks-json-read'
import {
  getCodexExplicitHomeHookSourcePath,
  normalizeCodexHookSourcePath
} from './config-toml-trust'

/** The user's real `~/.codex` hook files, plus the guard and pristine backup
 *  the real-home lane needs before it is allowed to mutate them. */
export function getRealHomeHooksJsonPath(): string {
  return join(getSystemCodexHomePath(), 'hooks.json')
}

/**
 * Every key Codex may give an entry in ~/.codex/hooks.json: as spelled when it
 * runs on its default home, resolved when a pane's CODEX_HOME names it. They
 * differ when ~/.codex or HOME is a symlink, and Orca approves under both.
 */
export function getRealHomeHookKeySourcePaths(): [string, ...string[]] {
  const hooksJsonPath = getRealHomeHooksJsonPath()
  const spelled = normalizeCodexHookSourcePath(hooksJsonPath)
  const resolved = getCodexExplicitHomeHookSourcePath(hooksJsonPath)
  return resolved === spelled ? [spelled] : [spelled, resolved]
}

/** HiveCode-side state dir; nothing extra is ever written into the user's ~/.codex. */
function getRealHomeHookStateDir(userDataPath: string): string {
  return join(userDataPath, 'codex-real-home-hooks')
}

/** Another process saved hooks.json between Orca's read and its write. */
export class HooksJsonChangedError extends Error {
  constructor() {
    super(`Codex hooks.json changed since ${APP_DISPLAY_NAME} read it`)
    this.name = 'HooksJsonChangedError'
  }
}

/** Why ~/.codex/hooks.json cannot take Orca's entry, read from the file now; null when it can. */
export function readRealHomeHooksFileProblem(): string | null {
  const hooksJsonPath = getRealHomeHooksJsonPath()
  const { raw, config } = readHooksJsonWithRaw(hooksJsonPath)
  if (raw === null) {
    return null
  }
  return isAddableHooksFile(config)
    ? null
    : `${APP_DISPLAY_NAME} cannot add its hook to ${hooksJsonPath}, so ${APP_DISPLAY_NAME} shows no status for ~/.codex`
}

// Why: an unparseable user file is never clobbered, and Codex skips a file with other root keys
// or an event that is not a list, whose value Orca would otherwise replace.
export function isAddableHooksFile(config: HooksConfig | null): config is HooksConfig {
  return (
    config !== null &&
    Object.keys(config).every((key) => key === 'hooks' || key === 'description') &&
    (config.hooks === undefined ||
      (isPlainObject(config.hooks) && Object.values(config.hooks).every(Array.isArray)))
  )
}

export function assertHooksJsonGeneration(
  hooksJsonPath: string,
  hooksWritePath: string,
  expectedRaw: string | null
): void {
  const currentRaw = existsSync(hooksJsonPath) ? readFileSync(hooksJsonPath, 'utf-8') : null
  if (currentRaw !== expectedRaw || resolveHooksJsonWritePath(hooksJsonPath) !== hooksWritePath) {
    // Why: another process may have saved since the read. Abort rather than
    // atomically replacing a newer file with the stale parsed snapshot.
    throw new HooksJsonChangedError()
  }
}

/** One-time pristine copy of the user's file, kept under HiveCode's userData. */
export function backupRealHomeHooksJsonOnce(
  userDataPath: string,
  previousRaw: string | null
): void {
  if (previousRaw === null) {
    return
  }
  const backupDir = getRealHomeHookStateDir(userDataPath)
  const backupPath = join(backupDir, 'hooks.json.pre-orca')
  if (existsSync(backupPath)) {
    return
  }
  // Why: this lane mutates the user's real Codex home. If the required
  // pristine recovery copy cannot be created, keep the managed lane intact.
  mkdirSync(backupDir, { recursive: true })
  writeFileAtomically(backupPath, previousRaw, { mode: 0o600 })
}

export function restoreRealHomeHooksJson(
  hooksJsonPath: string,
  previousRaw: string | null,
  previousMode?: number
): void {
  if (previousRaw === null) {
    if (existsSync(hooksJsonPath)) {
      unlinkSync(hooksJsonPath)
    }
    return
  }
  // Why: rollback is part of the safety boundary. Use the shared atomic
  // writer so Windows file-lock retries and failed-temp cleanup are covered.
  writeFileAtomically(hooksJsonPath, previousRaw, { mode: previousMode })
}

/** Places HiveCode's managed hook in `definitions`, reusing its existing slot when
 *  one is unambiguous so no later user trust position shifts. */
export function reconcileManagedHookDefinition(
  current: HookDefinition[],
  isManagedCommand: (command: string | undefined) => boolean,
  command: string
): { definitions: HookDefinition[]; groupIndex: number; handlerIndex: number } {
  const directCommandKeys = ['command', 'bash', 'powershell'] as const
  const hasManagedDirectCommand = current.some((definition) =>
    directCommandKeys.some((key) => isManagedCommand(definition[key]))
  )
  const nestedLocations = current.flatMap((definition, groupIndex) =>
    Array.isArray(definition.hooks)
      ? definition.hooks.flatMap((hook, handlerIndex) =>
          isManagedCommand(hook.command) ? [{ groupIndex, handlerIndex }] : []
        )
      : []
  )
  if (!hasManagedDirectCommand && nestedLocations.length === 1) {
    const { groupIndex, handlerIndex } = nestedLocations[0]!
    const definition = current[groupIndex]!
    const hasDirectCommand = directCommandKeys.some((key) => typeof definition[key] === 'string')
    if (definition.matcher === undefined && !hasDirectCommand) {
      const definitions = [...current]
      // Why: users can append groups or handlers after HiveCode's first install.
      // Reusing the exact slot preserves all later positional trust keys.
      const hooks = [...definition.hooks!]
      hooks[handlerIndex] = buildManagedCommandHook(command)
      definitions[groupIndex] = { ...definition, hooks }
      return { definitions, groupIndex, handlerIndex }
    }
  }

  const cleaned = removeManagedCommands(current, isManagedCommand)
  // Why: first install appends LAST so no existing user trust position shifts.
  return {
    definitions: [...cleaned, { hooks: [buildManagedCommandHook(command)] }],
    groupIndex: cleaned.length,
    handlerIndex: 0
  }
}
