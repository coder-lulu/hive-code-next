import { closeSync, fstatSync, readSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { openRegularTranscript } from '../../shared/agent-hook-listener/safe-transcript-opener'

const configurationSchema = z.strictObject({
  dockerPath: z.string().min(1).max(4096),
  endpoint: z.string().min(1).max(4096),
  imageId: z.string().regex(/^sha256:[0-9a-f]{64}(?![\s\S])/)
})
export type TaskDockerRuntimeConfiguration = Readonly<z.infer<typeof configurationSchema>>

function readConfiguration(path: string) {
  const opened = openRegularTranscript(path)
  if (!opened) {
    throw new Error('TASK_DOCKER_CONFIGURATION_REFUSED')
  }
  try {
    if (opened.stats.size > 16_384) {
      throw new Error('TASK_DOCKER_CONFIGURATION_REFUSED')
    }
    const buffer = Buffer.alloc(16_385)
    let length = 0
    while (length < buffer.length) {
      const bytes = readSync(opened.fd, buffer, length, buffer.length - length, length)
      if (bytes === 0) {
        break
      }
      length += bytes
    }
    const after = fstatSync(opened.fd)
    if (
      length > 16_384 ||
      after.size !== opened.stats.size ||
      after.mtimeMs !== opened.stats.mtimeMs ||
      after.ctimeMs !== opened.stats.ctimeMs
    ) {
      throw new Error('TASK_DOCKER_CONFIGURATION_REFUSED')
    }
    return buffer.subarray(0, length).toString('utf8')
  } finally {
    closeSync(opened.fd)
  }
}

/** Host deployment data; the original boundary still verifies the actual daemon, image and CID. */
export function readTaskDockerRuntimeConfiguration(
  stateDirectory: string
): TaskDockerRuntimeConfiguration {
  try {
    const path = join(stateDirectory, 'hive-tasks', 'docker-runtime.json')
    const parsed = configurationSchema.parse(JSON.parse(readConfiguration(path)))
    if (!isAbsolute(parsed.dockerPath) || /[\0\r\n]/.test(parsed.dockerPath + parsed.endpoint)) {
      throw new Error('TASK_DOCKER_CONFIGURATION_REFUSED')
    }
    return Object.freeze(parsed)
  } catch {
    throw new Error('TASK_DOCKER_RUNTIME_UNAVAILABLE')
  }
}
