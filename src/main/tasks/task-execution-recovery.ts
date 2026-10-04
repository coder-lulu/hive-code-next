import type { TaskExecutionRecord } from './task-execution-record'
import type { TaskExecutionPersistence } from './task-execution-store'

export async function recoverPersistedTaskExecution(options: {
  store: Pick<TaskExecutionPersistence, 'recoverLaunch' | 'markUnknown'>
  read(): TaskExecutionRecord
  isLaunching(fingerprint: string): boolean
  now(): number
  validate(): void
  assertAuthorized(): void
  launchFingerprint: string | null
  settle(record: TaskExecutionRecord, validate: () => void): Promise<void>
  cancelRevoked(record: TaskExecutionRecord): Promise<void>
}): Promise<void> {
  options.validate()
  let current = options.read()
  if (current.result) {
    return
  }
  if (current.dispatch === 'dispatching' && !options.isLaunching(current.commandFingerprint)) {
    try {
      if (options.launchFingerprint !== null) {
        await options.store.recoverLaunch(
          current.command,
          options.launchFingerprint,
          options.now(),
          options.validate
        )
      }
    } catch {
      options.validate()
    }
    current = options.read()
    if (current.dispatch === 'dispatching') {
      await options.store.markUnknown(current.command, options.now(), options.validate)
    }
  }
  try {
    options.assertAuthorized()
  } catch {
    return options.cancelRevoked(current)
  }
  await options.settle(current, () => {
    options.validate()
    options.assertAuthorized()
  })
}
