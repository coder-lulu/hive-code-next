import { vi } from 'vitest'
import * as windowsAcl from '../../shared/secure-path-windows-acl'

const pendingWindowsHardening = new Set<Promise<void>>()
const restrictWindowsPath = windowsAcl.restrictWindowsDirectory
const aclHardeningObserver = vi
  .spyOn(windowsAcl, 'restrictWindowsDirectory')
  .mockImplementation((targetPath) => {
    const pending = restrictWindowsPath(targetPath)
    pendingWindowsHardening.add(pending.then(() => undefined))
    return pending
  })

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
