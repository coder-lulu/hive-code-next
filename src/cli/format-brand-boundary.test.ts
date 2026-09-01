import { describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME } from '../shared/brand'
import { RuntimeRpcFailureError } from './runtime-client'
import { formatCliError, formatHostList, printResult, reportCliError } from './format'

describe('CLI format brand boundary', () => {
  it('preserves arbitrary error text that resembles a legacy product reference', () => {
    expect(formatCliError(new Error('Project orca is ready at https://orca.dev.'))).toBe(
      'Project orca is ready at https://orca.dev.'
    )
  })

  it('preserves remote JSON error payloads verbatim', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = new RuntimeRpcFailureError({
      id: 'req_brand',
      ok: false,
      error: {
        code: 'runtime_unavailable',
        message: 'Orca is unavailable.',
        data: {
          nextSteps: ['Run `orca open --json`.', 'Check ORCA_CLI_COMMAND.'],
          compatibilityEnv: 'ORCA_CLI_COMMAND'
        }
      },
      _meta: { runtimeId: null }
    })

    reportCliError(error, true)

    const payload = JSON.parse(String(log.mock.calls[0]?.[0]))
    expect(payload.error.message).toBe('Orca is unavailable.')
    expect(payload.error.data.nextSteps).toEqual([
      'Run `orca open --json`.',
      'Check ORCA_CLI_COMMAND.'
    ])
    expect(payload.error.data.compatibilityEnv).toBe('ORCA_CLI_COMMAND')
  })

  it('prints formatter output verbatim', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const rawOutput = 'terminal output: orca status\nproject: orca\nurl: https://orca.dev'

    printResult(
      {
        id: 'req-verbatim',
        ok: true,
        result: rawOutput,
        _meta: { runtimeId: 'runtime-1' }
      },
      false,
      (value) => value
    )

    expect(log).toHaveBeenCalledWith(rawOutput)
  })

  it('labels paired environments with the canonical product name', () => {
    expect(
      formatHostList({
        hosts: [
          {
            kind: 'environment',
            name: 'remote-dev',
            id: 'runtime-1',
            selector: 'environment:runtime-1'
          }
        ]
      })
    ).toContain(`${APP_DISPLAY_NAME} server`)
  })
})
