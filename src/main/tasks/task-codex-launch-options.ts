import { taskDockerModelProfile } from './task-docker-model-profile'
import { refuseTaskExecution } from './task-execution-error'

export function taskCodexLaunchOptions(): Readonly<Record<string, string>> {
  return Object.freeze({ model: taskDockerModelProfile().model, effort: 'low', fastMode: 'false' })
}

export function assertTaskCodexLaunchOptions(
  options: Readonly<Record<string, string>> | undefined
) {
  const fixed = taskCodexLaunchOptions()
  if (options && Object.entries(options).some(([key, value]) => value !== fixed[key])) {
    return refuseTaskExecution('FORBIDDEN')
  }
}
