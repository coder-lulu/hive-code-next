import { mkdir, realpath } from 'node:fs/promises'
import { closeSync, fstatSync, openSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnProcess } from '../shared/child-process/run-process'
import { getDefaultUserDataPath } from './runtime/metadata'
import type { HiveAiCatalogModel, HiveAiModelSelection } from '../shared/hive-ai-model-catalog'
import {
  readHiveNativeMetadata,
  releaseHiveNativeLease,
  startHiveNativeConnection,
  type HiveNativeLaunch
} from './hive-native-connection'

export function nativeHiveConsoleInput(args: string[]): number | null {
  if (
    process.platform !== 'win32' ||
    !process.versions.electron ||
    process.stdin.isTTY ||
    !process.stdout.isTTY ||
    args.some((arg) => ['--print', '-p', '--mode'].includes(arg) || arg.startsWith('--mode='))
  ) {
    return null
  }
  // Electron replaces console stdin with NUL; preserve actual pipes and reopen the attached console.
  if (!fstatSync(0).isCharacterDevice()) {
    return null
  }
  return openSync('\\\\.\\CONIN$', 'r+')
}

export async function nativeHiveSessionArgs(args: string[], agentDirectory: string, cwd: string) {
  const agentRoot = await realpath(agentDirectory)
  const sessionDirectory = join(agentRoot, 'sessions')
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 })
  const root = await realpath(sessionDirectory)
  if (root !== sessionDirectory) {
    throw new Error('Hive session directory must not redirect elsewhere')
  }
  const result = [...args]
  for (let index = 0; index < result.length; index++) {
    if (result[index] === '--session-dir' || result[index].startsWith('--session-dir=')) {
      throw new Error('Hive session storage is scoped to the signed-in account')
    }
    if (!['--session', '--fork'].includes(result[index])) {
      continue
    }
    const value = result[++index]
    if (!value) {
      throw new Error('Missing Hive session selection')
    }
    if (!value.includes('/') && !value.includes('\\') && !value.endsWith('.jsonl')) {
      continue
    }
    const target = await realpath(resolve(cwd, value))
    const path = relative(root, target)
    if (!path || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
      throw new Error('Cannot restore a session outside the current Hive account')
    }
    result[index] = target
  }
  return ['--session-dir', root, ...result]
}

export function nativeHiveModels(
  models: HiveAiCatalogModel[],
  selection: HiveAiModelSelection | null
) {
  return models
    .filter((model) => model.contextWindow !== null && model.maxOutputTokens !== null)
    .map(({ modelId, protocols, contextWindow, maxOutputTokens }) => ({
      id: modelId,
      name: modelId,
      api: (
        selection?.modelId === modelId && protocols.includes(selection.protocol)
          ? selection.protocol === 'RESPONSES'
          : protocols.includes('RESPONSES')
      )
        ? 'openai-responses'
        : 'openai-completions',
      contextWindow,
      maxTokens: maxOutputTokens,
      input: ['text'],
      reasoning: false
    }))
}

/** Runs the bundled, unmodified Pi CLI. Only provider/auth configuration is Hive-owned. */
export async function runHiveAi(args: string[], cwd: string): Promise<void> {
  const metadataPath = join(getDefaultUserDataPath(), 'hive-native', 'bridge.json')
  const metadata = await readHiveNativeMetadata(metadataPath)
  const response = await fetch(`${metadata.baseUrl}/launch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${metadata.token}` },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error'
  })
  if (!response.ok) {
    try {
      await response.body?.cancel()
    } catch {
      // Preserve the launch refusal when an errored or locked response cannot be cancelled.
    }
    throw new Error('HiveCode AI cannot start. Check your Hive login and available models.')
  }
  const launch: HiveNativeLaunch = await response.json()
  let connection: Awaited<ReturnType<typeof startHiveNativeConnection>> | undefined
  try {
    const models = nativeHiveModels(launch.models, launch.selection)
    if (args.length === 1 && args[0] === '--list-models') {
      process.stdout.write(
        `${JSON.stringify({
          models: models.map((model) => ({
            selector: `hivecode/${model.id}`,
            id: model.id,
            provider: 'hivecode',
            name: model.name
          }))
        })}\n`
      )
      return
    }
    const selected = launch.selection?.modelId ?? models[0]?.id
    if (selected && !models.some((model) => model.id === selected)) {
      throw new Error(
        'HiveCode AI model limits are not configured. Ask an administrator to configure the context window and maximum output in New API integration settings.'
      )
    }
    if (!selected) {
      throw new Error(
        'No Hive models with configured context and output limits are available. Check New API integration model capabilities.'
      )
    }
    const sessionArgs = await nativeHiveSessionArgs(args, launch.agentDirectory, cwd)
    let child: ReturnType<typeof spawnProcess> | undefined
    connection = await startHiveNativeConnection({
      metadataPath,
      metadata,
      launch,
      onRevoked: () => child?.kill('SIGTERM')
    })
    const consoleInput = nativeHiveConsoleInput(args)
    try {
      child = spawnProcess({
        program: join(launch.runtimeDirectory, process.platform === 'win32' ? 'node.exe' : 'node'),
        args: [
          '--import',
          pathToFileURL(join(launch.runtimeDirectory, 'launcher.mjs')).href,
          join(launch.runtimeDirectory, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
          ...sessionArgs
        ],
        cwd,
        stdio: consoleInput === null ? 'inherit' : [consoleInput, 'inherit', 'inherit'],
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: launch.agentDirectory,
          HIVECODE_AI_BASE_URL: connection.baseUrl,
          HIVECODE_AI_LOCAL_TOKEN: launch.token,
          HIVECODE_AI_DEFAULT_MODEL: launch.selection?.modelId ?? '',
          HIVECODE_AI_MODELS: JSON.stringify(models)
        }
      })
    } finally {
      if (consoleInput !== null) {
        closeSync(consoleInput)
      }
    }
    const interrupt = () => child?.kill('SIGINT')
    const terminate = () => child?.kill('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    try {
      process.exitCode = await new Promise<number>((resolve, reject) => {
        child!.once('error', reject)
        child!.once('exit', (code) => resolve(code ?? 1))
      })
    } finally {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
    }
  } finally {
    await (connection ? connection.close() : releaseHiveNativeLease(metadata, launch))
  }
}
