import { compareAppVersions, isValidAppVersion } from '../../shared/app-version'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCliCommands } from '../../shared/node-cli-command-resolution'

export async function ensureAgentBunRuntime(
  env: NodeJS.ProcessEnv,
  command?: string
): Promise<string> {
  const bun = command ?? resolveCliCommands(['bun'], { pathEnv: env.PATH ?? env.Path }).get('bun')
  if (!bun) {
    throw new Error('bun-unavailable')
  }
  const runtime = await runProcess({
    program: bun,
    args: ['--version'],
    env,
    timeoutMs: 10_000,
    maxOutputBytes: 4096
  })
  const version = runtime.stdout.trim()
  if (
    runtime.code !== 0 ||
    runtime.timedOut ||
    runtime.outputTruncated ||
    !isValidAppVersion(version) ||
    compareAppVersions(version, '1.3.14') < 0
  ) {
    throw new Error('bun-unavailable')
  }
  return bun
}
