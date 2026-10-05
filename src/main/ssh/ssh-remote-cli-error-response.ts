import type { RpcResponse } from '../runtime/rpc/core'
import type { RemoteOrcaCliResult } from './ssh-remote-cli-host-passthrough'

export function buildRemoteCliError(message: string, code = 'runtime_error'): RpcResponse {
  return {
    id: 'remote-cli-local',
    ok: false,
    error: { code, message },
    _meta: { runtimeId: 'unknown' }
  }
}

export function formatRemoteCliError(
  message: string,
  code: string,
  json: boolean
): RemoteOrcaCliResult {
  return json
    ? {
        stdout: `${JSON.stringify(buildRemoteCliError(message, code), null, 2)}\n`,
        stderr: '',
        exitCode: 1
      }
    : { stdout: '', stderr: `${message}\n`, exitCode: 1 }
}
