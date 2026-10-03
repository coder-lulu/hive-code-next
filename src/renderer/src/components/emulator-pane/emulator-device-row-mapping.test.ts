import { describe, expect, it } from 'vitest'
import {
  simulatorDeviceStateLabel,
  toSimulatorDeviceRows,
  toSimulatorDeviceState
} from './emulator-device-row-mapping'

describe('emulator device row mapping', () => {
  it('preserves every device health state returned by the emulator RPC', () => {
    expect(
      toSimulatorDeviceRows([
        { id: 'off', name: 'Off', state: 'shutdown' },
        { id: 'starting', name: 'Starting', state: 'booting' },
        { id: 'ready', name: 'Ready', state: 'booted' },
        { id: 'stuck', name: 'Stuck', state: 'unresponsive' }
      ]).map((device) => device.state)
    ).toEqual(['Shutdown', 'Booting', 'Booted', 'Unresponsive'])
  })

  it('keeps unknown legacy states safely disconnected', () => {
    expect(toSimulatorDeviceState('unknown')).toBe('Shutdown')
  })

  it('provides distinct visible labels for booting and unresponsive devices', () => {
    expect(simulatorDeviceStateLabel('Booting')).toBe('Booting')
    expect(simulatorDeviceStateLabel('Unresponsive')).toBe('Unresponsive')
    expect(simulatorDeviceStateLabel('Shutdown')).toBe('Shut down')
  })
})
