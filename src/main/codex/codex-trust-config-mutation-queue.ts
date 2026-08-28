import { AsyncLocalStorage } from 'node:async_hooks'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'

const tailByTomlPath = new Map<string, Promise<void>>()
const heldKeys = new AsyncLocalStorage<ReadonlySet<string>>()

/** Serialize asynchronous mutations of one Codex config.toml. */
export function runExclusivelyForCodexTrustConfig<T>(
  tomlPath: string,
  run: () => Promise<T>
): Promise<T> {
  const key = normalizeRuntimePathForComparison(tomlPath)
  const held = heldKeys.getStore()
  if (held?.has(key)) {
    return run()
  }
  const owned = new Set(held ?? [])
  owned.add(key)
  const enter = (): Promise<T> => heldKeys.run(owned, run)
  const previous = tailByTomlPath.get(key) ?? Promise.resolve()
  const result = previous.then(enter, enter)
  const tail = result.then(
    () => undefined,
    () => undefined
  )
  tailByTomlPath.set(key, tail)
  void tail.then(() => {
    if (tailByTomlPath.get(key) === tail) {
      tailByTomlPath.delete(key)
    }
  })
  return result
}
