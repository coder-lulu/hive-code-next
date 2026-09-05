import { EmulatorError } from '../emulator-errors'
import type { AndroidAdbDevice } from './adb-devices'
import type { AndroidCommandRunner } from './android-command-runner'
import type { AndroidSdkPaths } from './android-sdk-discovery'
import { listRunningAdbDevices } from './android-device-inventory'
import { probeAndroidDeviceHealth, type AndroidDeviceHealth } from './android-device-health'
import {
  androidAvdBootTimedOutError,
  androidAvdLaunchExitedError,
  externalAndroidEmulatorUnresponsiveError
} from './android-avd-boot-errors'
import type {
  AndroidManagedAvdProcess,
  AndroidManagedAvdProcesses
} from './android-managed-avd-processes'

export type AndroidBootBudget = {
  remainingMs: number
  usedColdRestart: boolean
}

type AndroidBootPollingOptions = {
  pollIntervalMs: number
  sleep: (ms: number) => Promise<void>
}

export async function probeDeviceHealthDuringBoot(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  device: AndroidAdbDevice
): Promise<AndroidDeviceHealth> {
  // ADB exposes a newly launched emulator as `offline` before its transport is
  // ready for shell commands. During the startup budget this is progress, not
  // evidence that the emulator is hung.
  if (device.state === 'offline') {
    return 'booting'
  }
  return probeAndroidDeviceHealth(runner, sdk, device.serial)
}

export async function waitForUnidentifiedExternalEmulatorTransition(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  initialDevice: AndroidAdbDevice,
  avdName: string,
  options: AndroidBootPollingOptions,
  budget: AndroidBootBudget
): Promise<AndroidAdbDevice> {
  let currentDevice: AndroidAdbDevice | undefined = initialDevice

  while (budget.remainingMs > 0) {
    await waitForNextPoll(options, budget, null)
    const running = await listRunningAdbDevices(runner, sdk)
    currentDevice = running.find((device) => device.serial === initialDevice.serial)
    if (currentDevice && currentDevice.state !== 'offline') {
      return currentDevice
    }
  }

  if (currentDevice?.state === 'offline') {
    throw externalAndroidEmulatorUnresponsiveError(currentDevice.serial, avdName, true)
  }
  throw androidAvdBootTimedOutError(avdName)
}

export async function waitForNextPoll(
  options: AndroidBootPollingOptions,
  budget: AndroidBootBudget,
  process: AndroidManagedAvdProcess | null
): Promise<void> {
  const waitMs = Math.min(options.pollIntervalMs, budget.remainingMs)
  if (waitMs <= 0) {
    return
  }
  budget.remainingMs -= waitMs
  if (!process) {
    await options.sleep(waitMs)
    return
  }
  await Promise.race([options.sleep(waitMs), process.exit.then(() => undefined)])
  if (process.exitResult) {
    throw androidAvdLaunchExitedError(process)
  }
}

export function launchManagedAvd(
  managedAvds: AndroidManagedAvdProcesses,
  emulatorPath: string,
  avdName: string,
  coldBoot: boolean
): AndroidManagedAvdProcess {
  try {
    return managedAvds.launch(emulatorPath, avdName, { coldBoot })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new EmulatorError(
      'emulator_helper_failed',
      `Could not launch AVD "${avdName}": ${message}`
    )
  }
}

export async function stopTimedOutManagedAvd(
  process: AndroidManagedAvdProcess,
  managedAvds: AndroidManagedAvdProcesses
): Promise<void> {
  if (!(await managedAvds.terminate(process))) {
    throw new EmulatorError(
      'emulator_helper_failed',
      `AVD "${process.avdName}" timed out and HiveCode could not stop its process safely.`
    )
  }
}
