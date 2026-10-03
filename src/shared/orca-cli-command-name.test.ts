import { describe, expect, it } from 'vitest'
import {
  getCompatibilityCliCommandNamesForPlatform,
  getGlobalCliCommandNamesForPlatform,
  getHiveCodeCliCommandNameForPlatform,
  getOrcaCliCommandNameForPlatform
} from './orca-cli-command-name'

describe('CLI command name', () => {
  it('uses the HiveCode primary command on Unix platforms', () => {
    expect(getHiveCodeCliCommandNameForPlatform('linux')).toBe('hive')
    expect(getHiveCodeCliCommandNameForPlatform('darwin')).toBe('hive')
  })

  it('uses the Windows command shim suffix', () => {
    expect(getHiveCodeCliCommandNameForPlatform('win32')).toBe('hive.cmd')
  })

  it('keeps the old helper on compatibility commands for internal launch shims', () => {
    expect(getOrcaCliCommandNameForPlatform('linux')).toBe('orca-ide')
    expect(getOrcaCliCommandNameForPlatform('darwin')).toBe('orca')
    expect(getOrcaCliCommandNameForPlatform('win32')).toBe('orca.cmd')
  })

  it('defines safe global compatibility aliases per platform', () => {
    expect(getCompatibilityCliCommandNamesForPlatform('darwin')).toEqual([
      'hivecode',
      'orca',
      'orca-ide'
    ])
    expect(getCompatibilityCliCommandNamesForPlatform('linux')).toEqual(['hivecode', 'orca-ide'])
    expect(getCompatibilityCliCommandNamesForPlatform('win32')).toEqual([
      'hivecode.cmd',
      'orca.cmd',
      'orca-ide.cmd'
    ])
  })

  it('never claims the GNOME orca command in the Linux global command set', () => {
    expect(getGlobalCliCommandNamesForPlatform('linux')).toEqual(['hive', 'hivecode', 'orca-ide'])
    expect(getGlobalCliCommandNamesForPlatform('linux')).not.toContain('orca')
    expect(getGlobalCliCommandNamesForPlatform('darwin')).toEqual([
      'hive',
      'hivecode',
      'orca',
      'orca-ide'
    ])
    expect(getGlobalCliCommandNamesForPlatform('win32')).toEqual([
      'hive.cmd',
      'hivecode.cmd',
      'orca.cmd',
      'orca-ide.cmd'
    ])
  })
})
