import { app } from 'electron'
import { startLocalTaskRuntime } from '../tasks/local-task-runtime'
import { mainProcessState as state } from './main-process-state'

let starting: Promise<Awaited<ReturnType<typeof startLocalTaskRuntime>> | null> | undefined

export function initializeLocalTasks() {
  if (
    starting ||
    !state.runtime ||
    !state.store ||
    !state.hiveAccountService ||
    !state.localRuntimeOwnership ||
    !state.runtimeCloudPresence
  ) {
    return
  }
  const options = {
    userDataPath: app.getPath('userData'),
    runtime: state.runtime,
    store: state.store,
    account: state.hiveAccountService,
    ownership: state.localRuntimeOwnership,
    presence: state.runtimeCloudPresence
  }
  starting = Promise.resolve(state.hiveAccountStartupState)
    .then(async () => {
      if (state.isQuitting) {
        return null
      }
      const tasks = await startLocalTaskRuntime(options)
      if (state.isQuitting) {
        await tasks.close()
        return null
      }
      return tasks
    })
    .catch(() => {
      console.error('Hive task service is unavailable')
      return null
    })
}

export async function getLocalTasks() {
  const tasks = await starting
  if (!tasks) {
    throw new Error('CAPABILITY_UNAVAILABLE')
  }
  return tasks
}

export async function stopLocalTasks() {
  await (await starting)?.close()
}
