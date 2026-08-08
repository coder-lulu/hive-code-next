/**
 * Root-package installers reopen the downloaded path from a privileged process.
 * The updater cannot pass a stable, already-verified file descriptor through
 * electron-updater, so automatic deb/rpm installs are fail-closed.
 */
export function requiresManualLinuxRootPackageInstall(): boolean {
  return true
}
