import { requireOptionalNativeModule } from 'expo-modules-core'

type ExpoHiveCodeUpdaterNativeModule = {
  hasApkInstallPermission: () => Promise<boolean>
  addListener: (
    event: string,
    listener: (progress: ApkDownloadProgress) => void
  ) => { remove: () => void }
  openApkInstaller: (contentUri: string) => Promise<void>
  requestApkInstallPermission: () => Promise<boolean>
  downloadVerifiedApk: (
    downloadUrl: string,
    allowedOrigin: string,
    allowedCdnOrigin: string | null,
    expectedSize: number,
    expectedSha256: string
  ) => Promise<string>
  deleteDownloadedApk: (contentUri: string) => Promise<void>
}

export type ApkDownloadProgress = { sha256: string; downloadedBytes: number; totalBytes: number }

export async function hasApkInstallPermission(): Promise<boolean> {
  if (!nativeModule) {
    throw new Error('Android APK installer is unavailable in this build.')
  }
  return nativeModule.hasApkInstallPermission()
}

export function subscribeApkDownloadProgress(
  listener: (progress: ApkDownloadProgress) => void
): () => void {
  if (!nativeModule) {
    throw new Error('Android APK downloader is unavailable in this build.')
  }
  const subscription = nativeModule.addListener('onDownloadProgress', listener)
  return () => subscription.remove()
}

/**
 * Android-only bridge. A missing native module is reported as an actionable
 * error instead of falling back to a browser URL, because APK installation
 * must use a content:// URI with a read grant and the system Package Installer.
 */
const nativeModule =
  requireOptionalNativeModule<ExpoHiveCodeUpdaterNativeModule>('ExpoHiveCodeUpdater')

export async function openApkInstaller(contentUri: string): Promise<void> {
  if (!nativeModule) {
    throw new Error('Android APK installer is unavailable in this build.')
  }
  await nativeModule.openApkInstaller(contentUri)
}

export async function requestApkInstallPermission(): Promise<boolean> {
  if (!nativeModule) {
    throw new Error('Android APK installer is unavailable in this build.')
  }
  return nativeModule.requestApkInstallPermission()
}

export async function downloadVerifiedApk(options: {
  downloadUrl: string
  allowedOrigin: string
  allowedCdnOrigin: string | null
  expectedSize: number
  expectedSha256: string
}): Promise<string> {
  if (!nativeModule) {
    throw new Error('Android APK downloader is unavailable in this build.')
  }
  return nativeModule.downloadVerifiedApk(
    options.downloadUrl,
    options.allowedOrigin,
    options.allowedCdnOrigin,
    options.expectedSize,
    options.expectedSha256
  )
}

export async function deleteDownloadedApk(contentUri: string): Promise<void> {
  if (nativeModule) {
    await nativeModule.deleteDownloadedApk(contentUri)
  }
}
