import { copyFile, mkdir, mkdtemp, readFile, rm, chmod, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveHiveAgentTextPack } from '../native-chat/hive-agent-text-pack'
import { loadManagedPiTextPack } from './managed-pi-pack-loader'
import { installedPackFixture, packDigest } from './managed-pi-pack-loader.test-fixture'

it('verifies and probes a real copied bundled Node under a space/non-ASCII path without executing the runner', async () => {
  const temporaryRoot = resolve('logs/ai-pack-loader-20260914/tmp')
  await mkdir(temporaryRoot, { recursive: true })
  const ownedRoot = await mkdtemp(join(temporaryRoot, 'real-node-'))
  try {
    const fixture = await installedPackFixture(join(ownedRoot, '受管 Node with spaces'))
    const bundledNode = join(fixture.trust.rootDirectory, fixture.names.node)
    await copyFile(process.execPath, bundledNode)
    if (process.platform !== 'win32') {
      await chmod(bundledNode, 0o755)
    }
    const node = await readFile(bundledNode)
    fixture.index.artifacts.node = { sha256: packDigest(node), size: node.length }
    const content = 'throw new Error("Pack loading must not execute the runner")'
    await writeFile(join(fixture.trust.rootDirectory, fixture.names.runner), content)
    fixture.index.artifacts.runner = {
      sha256: packDigest(content),
      size: Buffer.byteLength(content)
    }
    await fixture.saveIndex()
    const pack = await loadManagedPiTextPack(fixture.trust)
    try {
      const admission = resolveHiveAgentTextPack(pack.readPack, 'personal', 'CHAT_COMPLETIONS')
      expect(admission.binding.packRevision).toBe(fixture.trust.indexSha256)
      expect(pack.getLaunchFiles().node).toBe(bundledNode)
      expect(admission.assertCurrent).not.toThrow()
      pack.dispose()
      expect(admission.assertCurrent).toThrow(/^hive_agent_pack_unavailable$/)
    } finally {
      pack.dispose()
    }
  } finally {
    const owned = relative(temporaryRoot, ownedRoot)
    if (owned && !owned.startsWith('..') && !isAbsolute(owned)) {
      await rm(ownedRoot, { recursive: true, force: true })
    }
  }
})
