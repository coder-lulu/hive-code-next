import type {
  AgentVersionRequest,
  AgentVersionResult,
  LatestAgentVersionRequest,
  LatestAgentVersionResult
} from '../../shared/agent-version-types'
import path from 'node:path'
import { NPM_AGENT_PACKAGES } from '../../shared/agent-install-types'
import { AGENT_NPM_REGISTRIES } from '../../shared/agent-npm-registry'
import { isPrereleaseAppVersion, isValidAppVersion } from '../../shared/app-version'
import { runProcess } from '../../shared/child-process/run-process'
import { resolveCliCommands, withCliRuntimeOnPath } from '../../shared/node-cli-command-resolution'
import { buildPosixCommandPathLookupScript } from '../../shared/posix-command-path-lookup'
import {
  PreflightReadAgentVersion,
  PreflightReadLatestAgentVersion
} from '../../shared/rpc-contract/preflight-params'
import { TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import { singleExecutable, versionFromOutput } from './agent-version-output'
import { hydrateShellPathForAgentDetection } from '../ipc/agent-detection-shell-path'
import { buildLocalPreflightEnv } from '../ipc/preflight-local-env'
import { getMainHttpClient } from '../network/http-client'
import { runWslProcess } from '../wsl/wsl-runner'

const AGENT_VERSION_TIMEOUT_MS = 5000
const AGENT_VERSION_MAX_OUTPUT_BYTES = 32 * 1024
const LATEST_VERSION_TIMEOUT_MS = 10000
const MAX_LATEST_METADATA_BYTES = 1024 * 1024
function npmAgentPackage(agent: AgentVersionRequest['agent']): string | undefined {
  return Object.hasOwn(NPM_AGENT_PACKAGES, agent)
    ? NPM_AGENT_PACKAGES[agent as keyof typeof NPM_AGENT_PACKAGES]
    : undefined
}

function guestVersionScript(command: string, args: readonly string[]): string {
  return [
    buildPosixCommandPathLookupScript(
      { kind: 'literal', value: command },
      { skipWindowsMountDirs: true }
    ),
    '[ -n "$resolved" ] || exit 127',
    'for _orca_win_mount in $_orca_win_mounts; do',
    '  case "$resolved/" in "$_orca_win_mount"/*) exit 127 ;; esac',
    'done',
    '_orca_version_bin="${resolved%/*}"',
    'if [ -x "$_orca_version_bin/node" ] && [ ! -d "$_orca_version_bin/node" ]; then',
    '  PATH="$_orca_version_bin:$PATH"; export PATH',
    'fi',
    `exec "$resolved" ${args.join(' ')}`
  ].join('\n')
}

export async function readAgentVersion(request: AgentVersionRequest): Promise<AgentVersionResult> {
  const parsed = PreflightReadAgentVersion.safeParse(request)
  if (!parsed.success) {
    return { status: 'error', version: null, reason: 'invalid-version-request' }
  }
  const { agent, commandOverride, wslDistro } = parsed.data
  if (wslDistro && process.platform !== 'win32') {
    return { status: 'unsupported', version: null, reason: 'wsl-target-unavailable' }
  }
  const command = singleExecutable(
    commandOverride?.trim() ||
      (agent === 'claude-agent-teams' ? 'claude' : TUI_AGENT_CONFIG[agent].detectCmd),
    process.platform === 'win32' && !wslDistro
  )
  if (!command) {
    return { status: 'unsupported', version: null, reason: 'complex-command-override' }
  }
  const args = agent === 'grok' ? ['version'] : ['--version']

  try {
    let result
    if (wslDistro) {
      result = await runWslProcess({
        distro: wslDistro,
        shell: 'bash',
        loginPath: 'preferred',
        script: guestVersionScript(command, args),
        timeoutMs: AGENT_VERSION_TIMEOUT_MS,
        maxOutputBytes: AGENT_VERSION_MAX_OUTPUT_BYTES
      })
      if (!result.environmentResolved) {
        return { status: 'error', version: null, reason: 'environment-unverifiable' }
      }
    } else {
      await hydrateShellPathForAgentDetection()
      const env = buildLocalPreflightEnv() ?? process.env
      const absolute = (process.platform === 'win32' ? path.win32 : path.posix).isAbsolute(command)
      const program = absolute
        ? command
        : (resolveCliCommands([command], {
            platform: process.platform,
            pathEnv: env.PATH ?? env.Path
          }).get(command) ?? command)
      result = await runProcess({
        program,
        args,
        env: withCliRuntimeOnPath(program, env),
        timeoutMs: AGENT_VERSION_TIMEOUT_MS,
        maxOutputBytes: AGENT_VERSION_MAX_OUTPUT_BYTES
      })
    }
    if (result.outputTruncated) {
      return { status: 'error', version: null, reason: 'version-output-unverifiable' }
    }
    if (result.timedOut || result.code !== 0) {
      return { status: 'error', version: null, reason: 'version-read-failed' }
    }
    const version = versionFromOutput(result.stdout, result.stderr)
    return version
      ? { status: 'ready', version }
      : { status: 'error', version: null, reason: 'version-output-unverifiable' }
  } catch {
    return { status: 'error', version: null, reason: 'version-read-failed' }
  }
}

type LatestVersionSource = Pick<LatestAgentVersionResult, 'channel' | 'packageName'> & {
  sourceUrl: string
}

function latestVersionSource(request: LatestAgentVersionRequest): LatestVersionSource | null {
  const packageName = npmAgentPackage(request.agent)
  if (packageName) {
    return {
      channel: 'npm-latest',
      packageName,
      sourceUrl: `${AGENT_NPM_REGISTRIES[request.registry ?? 'default']}/${packageName}/latest`
    }
  }
  if (request.agent === 'hermes') {
    return {
      channel: 'github-release',
      sourceUrl: 'https://api.github.com/repos/NousResearch/hermes-agent/releases/latest'
    }
  }
  const pythonPackage =
    request.agent === 'aider'
      ? 'aider-chat'
      : request.agent === 'mistral-vibe'
        ? 'mistral-vibe'
        : null
  return pythonPackage
    ? {
        channel: 'pypi-latest',
        packageName: pythonPackage,
        sourceUrl: `https://pypi.org/pypi/${pythonPackage}/json`
      }
    : null
}

function isVersionMetadata(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableMetadataVersion(metadata: unknown, source: LatestVersionSource): string | null {
  if (!isVersionMetadata(metadata)) {
    return null
  }
  let version: unknown
  if (source.channel === 'npm-latest') {
    if (metadata.name !== source.packageName) {
      return null
    }
    version = metadata.version
  } else if (source.channel === 'github-release') {
    if (
      metadata.draft !== false ||
      metadata.prerelease !== false ||
      typeof metadata.name !== 'string'
    ) {
      return null
    }
    version = versionFromOutput(metadata.name, '')
    // Hermes calendar tags cannot be compared with the CLI's semantic version.
    if (typeof version !== 'string' || Number(version.split('.')[0]) >= 1000) {
      return null
    }
  } else {
    if (
      !isVersionMetadata(metadata.info) ||
      metadata.info.name !== source.packageName ||
      !Array.isArray(metadata.urls) ||
      !metadata.urls.some((url) => isVersionMetadata(url) && url.yanked === false)
    ) {
      return null
    }
    version = metadata.info.version
  }
  return typeof version === 'string' &&
    version.length <= 128 &&
    isValidAppVersion(version) &&
    !isPrereleaseAppVersion(version)
    ? version.replace(/^v/i, '')
    : null
}

async function readLatestMetadata(response: Response): Promise<unknown> {
  if (!response.body) {
    return null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      length += chunk.value.byteLength
      if (length > MAX_LATEST_METADATA_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(chunk.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally {
    reader.releaseLock()
  }
}

export async function readLatestAgentVersion(
  request: LatestAgentVersionRequest
): Promise<LatestAgentVersionResult> {
  const parsed = PreflightReadLatestAgentVersion.safeParse(request)
  const base = { version: null, channel: 'npm-latest' } as const
  if (!parsed.success) {
    return { ...base, status: 'error', reason: 'invalid-version-request' }
  }
  const source = latestVersionSource(parsed.data)
  if (!source) {
    return { ...base, status: 'unsupported', reason: 'latest-provider-unavailable' }
  }
  try {
    const response = await getMainHttpClient().fetch(source.sourceUrl, {
      signal: AbortSignal.timeout(LATEST_VERSION_TIMEOUT_MS),
      headers: {
        Accept:
          source.channel === 'github-release' ? 'application/vnd.github+json' : 'application/json'
      },
      redirect: 'error'
    })
    if (!response.ok) {
      await response.body?.cancel()
      return { ...base, ...source, status: 'error', reason: 'latest-query-failed' }
    }
    const version = stableMetadataVersion(await readLatestMetadata(response), source)
    if (!version) {
      return { ...base, ...source, status: 'error', reason: 'latest-metadata-unverifiable' }
    }
    return { ...source, status: 'ready', version }
  } catch {
    return { ...base, ...source, status: 'error', reason: 'latest-query-failed' }
  }
}
