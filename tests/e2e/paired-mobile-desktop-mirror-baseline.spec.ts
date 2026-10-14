/** Phone authorization remains bound to its paired Runtime, even when that desktop renders another host. */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { launchPhoneMirrorTopology } from './helpers/phone-mirror-topology'
import { RuntimeClient } from '../../src/cli/runtime/client'
import type { RuntimeWorktreePsSummary } from '../../src/shared/runtime-worktree-contracts'

test('a phone token lists only its paired desktop workspace and excludes another Runtime', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(120_000)
  const serverFolder = testInfo.outputPath('server-folder')
  mkdirSync(serverFolder, { recursive: true })
  writeFileSync(path.join(serverFolder, 'README.md'), 'server workspace\n')

  const { host, desktop, phone, dispose } = await launchPhoneMirrorTopology(
    { phoneTo: 'desktop' },
    testInfo
  )
  try {
    await host.client.call('repo.add', { path: serverFolder, kind: 'folder' })
    await new RuntimeClient(desktop.userDataDir, 5_000).call('repo.add', {
      path: testRepoPath,
      kind: 'git'
    })
    // Precondition: the desktop window does show the server's workspace.
    await expect
      .poll(
        () =>
          desktop.page.evaluate(
            (folder) =>
              window.__store
                ?.getState()
                .allWorktrees()
                .some((worktree) => worktree.path === folder) ?? false,
            serverFolder
          ),
        { timeout: 30_000 }
      )
      .toBe(true)

    const { worktrees } = await phone.call<{ worktrees: RuntimeWorktreePsSummary[] }>(
      'worktree.ps',
      { limit: 1_000 }
    )
    const paths = worktrees.map((row) => row.path)
    expect(paths).toContain(testRepoPath)
    // Rendering another Runtime does not delegate that host to the phone token.
    expect(paths).not.toContain(serverFolder)
  } finally {
    await dispose()
  }
})
