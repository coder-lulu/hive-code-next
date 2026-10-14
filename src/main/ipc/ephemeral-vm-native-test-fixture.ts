import { vi } from 'vitest'
import * as windowsAcl from '../../shared/secure-path-windows-acl'

const pendingWindowsHardening = new Set<Promise<void>>()
const restrictWindowsPath = windowsAcl.bestEffortRestrictWindowsPath
const aclHardeningObserver = vi
  .spyOn(windowsAcl, 'bestEffortRestrictWindowsPath')
  .mockImplementation(
    (targetPath: string, isDirectory: boolean, onSettled?: (restricted: boolean) => void): void => {
      pendingWindowsHardening.add(
        new Promise<void>((resolve) => {
          restrictWindowsPath(targetPath, isDirectory, (restricted) => {
            try {
              onSettled?.(restricted)
            } finally {
              resolve()
            }
          })
        })
      )
    }
  )

export async function drainNativeFixture(pendingChildren: Set<Promise<void>>): Promise<void> {
  // Bounded cancellation may return before recipe/taskkill close; drain actual fixture work.
  await Promise.all(pendingWindowsHardening)
  pendingWindowsHardening.clear()
  await Promise.all(pendingChildren)
  pendingChildren.clear()
}

export function restoreNativeFixture(): void {
  aclHardeningObserver.mockRestore()
}
