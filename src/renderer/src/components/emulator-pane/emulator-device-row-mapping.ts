import { translate } from '@/i18n/i18n'
import type { SimulatorDeviceRow, SimulatorDeviceState } from './emulator-pane-types'

// Raw shape returned by the unified `emulator.listDevices` RPC (iOS simulators + Android AVDs).
export type RawEmulatorDevice = {
  id: string
  name: string
  state: string
  detail?: string
  isAvailable?: boolean
}

export function toSimulatorDeviceState(state: string): SimulatorDeviceState {
  switch (state.trim().toLowerCase()) {
    case 'booted':
      return 'Booted'
    case 'booting':
      return 'Booting'
    case 'unresponsive':
      return 'Unresponsive'
    default:
      return 'Shutdown'
  }
}

export function simulatorDeviceStateLabel(state: SimulatorDeviceState): string {
  switch (state) {
    case 'Booted':
      return translate('auto.components.emulator.pane.device.state.booted', 'Booted')
    case 'Booting':
      return translate('auto.components.emulator.pane.device.state.booting', 'Booting')
    case 'Unresponsive':
      return translate('auto.components.emulator.pane.device.state.unresponsive', 'Unresponsive')
    case 'Shutdown':
      return translate('auto.components.emulator.pane.device.state.shutdown', 'Shut down')
  }
}

export function toSimulatorDeviceRows(raw: RawEmulatorDevice[]): SimulatorDeviceRow[] {
  return raw.map((device) => ({
    name: device.name,
    udid: device.id,
    state: toSimulatorDeviceState(device.state),
    runtime: device.detail,
    isAvailable: device.isAvailable
  }))
}
