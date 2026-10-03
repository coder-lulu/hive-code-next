import { afterEach, describe, expect, it } from 'vitest'

import { PRIMARY_CLI_COMMAND } from '../../../shared/brand'
import {
  resolveCompatibilityCliCommand,
  resolvePackagedWindowsCompatibilityCommand
} from './runtime-compatibility'

const originalCommand = process.env.ORCA_CLI_COMMAND
const originalPackagedLauncher = process.env.ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER

afterEach(() => {
  if (originalCommand === undefined) {
    delete process.env.ORCA_CLI_COMMAND
  } else {
    process.env.ORCA_CLI_COMMAND = originalCommand
  }
  if (originalPackagedLauncher === undefined) {
    delete process.env.ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER
  } else {
    process.env.ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER = originalPackagedLauncher
  }
})

describe('orchestration CLI compatibility command', () => {
  it('uses the primary command by default and when explicitly pinned', () => {
    delete process.env.ORCA_CLI_COMMAND
    expect(resolveCompatibilityCliCommand()).toBe(PRIMARY_CLI_COMMAND)

    process.env.ORCA_CLI_COMMAND = PRIMARY_CLI_COMMAND
    expect(resolveCompatibilityCliCommand()).toBe(PRIMARY_CLI_COMMAND)
  })

  it('accepts the primary command from the packaged Windows launcher', () => {
    process.env.ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER = '1'
    process.env.ORCA_CLI_COMMAND = PRIMARY_CLI_COMMAND
    expect(resolvePackagedWindowsCompatibilityCommand()).toBe(PRIMARY_CLI_COMMAND)
  })

  it('accepts the HiveCode compatibility alias from the packaged Windows launcher', () => {
    process.env.ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER = '1'
    process.env.ORCA_CLI_COMMAND = 'hivecode'
    expect(resolvePackagedWindowsCompatibilityCommand()).toBe('hivecode')
  })
})
