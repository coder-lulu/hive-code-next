import { EmulatorError } from '../emulator-errors'
import type { AndroidManagedAvdProcess } from './android-managed-avd-processes'

export function androidAvdLaunchExitedError(process: AndroidManagedAvdProcess): EmulatorError {
  const result = process.exitResult
  const reason = result?.error?.message ?? process.output()
  const status =
    result?.code === undefined || result.code === null ? '' : ` (exit code ${result.code})`
  const detail = reason ? ` ${reason}` : ''
  return new EmulatorError(
    'emulator_helper_failed',
    `AVD "${process.avdName}" exited before it finished booting${status}.${detail}`
  )
}

export function externalAndroidEmulatorUnresponsiveError(
  serial: string,
  name: string,
  identityUnknown: boolean
): EmulatorError {
  const identity = identityUnknown
    ? `HiveCode cannot safely determine whether it is AVD "${name}". `
    : ''
  return new EmulatorError(
    'emulator_device_unresponsive',
    `Android emulator ${serial} is unresponsive. ${identity}Restart it in Android Studio or run "adb -s ${serial} emu kill", then try again. HiveCode will not stop an emulator it did not start.`
  )
}

export function androidAvdBootTimedOutError(avdName: string): EmulatorError {
  return new EmulatorError(
    'emulator_helper_failed',
    `AVD "${avdName}" did not finish booting in time.`
  )
}
