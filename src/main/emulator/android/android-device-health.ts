import type { AndroidCommandRunner } from './android-command-runner'
import type { AndroidSdkPaths } from './android-sdk-discovery'
import { bootCompletedArgs, isBootCompleted } from './adb-devices'

export type AndroidDeviceHealth = 'booted' | 'booting' | 'unresponsive'

export const ANDROID_DEVICE_PROBE_TIMEOUT_MS = 5_000

export async function probeAndroidDeviceHealth(
  runner: AndroidCommandRunner,
  sdk: AndroidSdkPaths,
  serial: string
): Promise<AndroidDeviceHealth> {
  const result = await runner(sdk.adb, bootCompletedArgs(serial), {
    timeoutMs: ANDROID_DEVICE_PROBE_TIMEOUT_MS
  })
  if (result.code !== 0) {
    return 'unresponsive'
  }
  return isBootCompleted(result.stdout) ? 'booted' : 'booting'
}
