import { describe, expect, it } from 'vitest'
import { requiresManualLinuxRootPackageInstall } from './linux-root-package-install-policy'

describe('linux root package install policy', () => {
  it('fails closed to a manual install because electron-updater cannot carry a verified fd', () => {
    expect(requiresManualLinuxRootPackageInstall()).toBe(true)
  })
})
