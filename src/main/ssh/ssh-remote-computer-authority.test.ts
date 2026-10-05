import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

const passthrough = vi.hoisted(() => vi.fn())
vi.mock('./ssh-remote-cli-host-passthrough', () => ({
  HostCliUnavailableError: class extends Error {},
  runHostOrcaCliPassthrough: passthrough
}))
vi.mock('../runtime/rpc/methods', () => ({ ALL_RPC_METHODS: {} }))

import { runRemoteOrcaCli } from './ssh-remote-orca-cli'

describe('SSH ingress cannot acquire host computer authority', () => {
  it.each([
    ['computer', 'screenshot'],
    ['computer', 'click', '--x', '1', '--y', '2'],
    ['computer', 'type', '--text', 'remote input'],
    ['computer', 'start'],
    ['computer', 'stop'],
    ['computer', '--help'],
    ['--json', 'computer', 'screenshot']
  ])('refuses %j before starting a host CLI or sidecar', async (...argv: string[]) => {
    passthrough.mockClear()
    passthrough.mockResolvedValue({ stdout: 'unexpected', stderr: '', exitCode: 0 })
    const result = await runRemoteOrcaCli({} as OrcaRuntimeService, {
      argv,
      env: {},
      cwd: process.cwd()
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout + result.stderr).toContain('computer_control_remote_origin_forbidden')
    expect(passthrough).not.toHaveBeenCalled()
  })
})
