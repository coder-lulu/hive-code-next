import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { build, transform } from 'esbuild'
import { format } from 'oxfmt'
import { describe, expect, it } from 'vitest'
import { paperclipCheckoutAliases } from './paperclip-checkout-source.mjs'
import {
  paperclipCaseKernelAliases,
  verifyPaperclipCaseKernelSources
} from './paperclip-case-kernel-source.mjs'
import { paperclipExternalExecutionSourceDigest } from './paperclip-source-proof.mjs'
import { normalizePaperclipCaseKernelSources } from './paperclip-case-kernel-normalization.mjs'

const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(
  await readFile(join(root, 'integration/paperclip/compatibility-manifest.json'), 'utf8')
)
const pin = manifest.caseTransitionCore
const artifacts = join(root, 'logs/paperclip-development/p3/case-outcomes/kernel-package/tests')
const databaseSource = resolve(
  process.env.HIVE_PAPERCLIP_SOURCE ?? join(root, 'logs/paperclip-p1/paperclip')
)
const upstreamSource = process.env.HIVE_PAPERCLIP_CASE_KERNEL_SOURCE
const digest = (text) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex')

async function fixture() {
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(join(artifacts, 'sources-'))
  for (const module of pin.modules) {
    const target = join(directory, module.vendoredModule)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(root, module.vendoredModule), target)
  }
  const typeProject = join(directory, pin.typeProject.module)
  await mkdir(dirname(typeProject), { recursive: true })
  await copyFile(join(root, pin.typeProject.module), typeProject)
  return directory
}

describe('reviewed standalone Case kernel source proof', () => {
  it('verifies actual vendored sources without an upstream checkout or Git directory', async () => {
    const directory = await fixture()
    expect(existsSync(join(directory, '.git'))).toBe(false)
    const proof = await verifyPaperclipCaseKernelSources(directory, manifest)
    expect(proof.revision).toBe('d56db5a46be1557314d93b1a4b2ba7d3947c2843')
    expect(proof.modules).toHaveLength(17)
    expect(proof.runtimeModules).toHaveLength(16)
    expect(proof.typeOnlyModules).toEqual([
      'integration/paperclip/core/case-kernel/services/pipeline-case-types.ts'
    ])
    expect(proof.typeOnlyExternals).toEqual(['@paperclipai/shared'])
    expect(proof.runtimeExternals).toEqual(['@paperclipai/db', 'drizzle-orm', 'node:util'])
  })

  it.each([
    ['missing entry', (m) => delete m.caseTransitionCore],
    ['missing module', (m) => m.caseTransitionCore.modules.pop()],
    ['extra module', (m) => m.caseTransitionCore.modules.push(pin.modules[0])],
    ['extra closure field', (m) => (m.caseTransitionCore.providerFactory = 'allowed')],
    ['unsupported runtime import', (m) => m.caseTransitionCore.runtimeExternals.push('postgres')],
    ['unsupported type import', (m) => m.caseTransitionCore.typeOnlyExternals.push('provider')],
    ['wrong revision', (m) => (m.caseTransitionCore.revision = manifest.paperclip.revision)],
    ['wrong repository', (m) => (m.caseTransitionCore.repository = manifest.paperclip.repository)],
    ['missing source hash', (m) => delete m.caseTransitionCore.modules[0].sourceSha256],
    ['extra module field', (m) => (m.caseTransitionCore.modules[0].loadProvider = true)],
    ['wrong normalizer version', (m) => (m.caseTransitionCore.normalization[0].version = 'latest')],
    [
      'wrong normalizer rules',
      (m) => m.caseTransitionCore.normalization[0].appliedRules.push('unsafe')
    ],
    [
      'wrong source entry',
      (m) => (m.caseTransitionCore.sourceEntry = 'server/src/services/pipelines.ts')
    ]
  ])('rejects %s before resolving source files', async (_, mutate) => {
    const changed = structuredClone(manifest)
    mutate(changed)
    await expect(
      verifyPaperclipCaseKernelSources(join(artifacts, 'absent'), changed)
    ).rejects.toThrow(/Case kernel (source proof is required|pin differs)/)
  })

  it('rejects changed source bytes even when a manifest digest is rewritten to match them', async () => {
    const directory = await fixture()
    const module = pin.modules.find((item) => item.module.endsWith('/pipeline-case-kernel.ts'))
    const target = join(directory, module.vendoredModule)
    const altered = `${await readFile(target, 'utf8')}\nexport const providerFactory = true\n`
    await writeFile(target, altered)
    await expect(verifyPaperclipCaseKernelSources(directory, manifest)).rejects.toThrow(
      'differs from the pinned provider-free source'
    )
    const changed = structuredClone(manifest)
    changed.caseTransitionCore.modules.find((item) => item.module === module.module).sha256 =
      digest(altered)
    await expect(verifyPaperclipCaseKernelSources(directory, changed)).rejects.toThrow(
      'pin differs from the reviewed source'
    )
  })

  it('requires every pinned local source including the erased types', async () => {
    const directory = await fixture()
    const module = pin.modules.find((item) => item.module.endsWith('/pipeline-case-types.ts'))
    await rm(join(directory, module.vendoredModule))
    await expect(verifyPaperclipCaseKernelSources(directory, manifest)).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('accepts only newline normalization and preserves canonical Root formatter output', async () => {
    const directory = await fixture()
    const {
      $schema: _schema,
      ignorePatterns: _ignorePatterns,
      ...options
    } = JSON.parse(await readFile(join(root, '.oxfmtrc.json'), 'utf8'))
    for (const module of pin.modules) {
      const target = join(directory, module.vendoredModule)
      const source = await readFile(target, 'utf8')
      const normalized = await format(module.vendoredModule, source, options)
      expect(normalized.errors).toEqual([])
      expect(normalized.code).toBe(source)
      expect(digest(normalized.code)).toBe(module.sha256)
      await writeFile(target, source.replaceAll('\n', '\r\n'))
    }
    expect((await verifyPaperclipCaseKernelSources(directory, manifest)).modules).toHaveLength(17)
  })

  it.skipIf(!upstreamSource)('reproduces the pins from all actual upstream bodies', async () => {
    await mkdir(artifacts, { recursive: true })
    const output = await mkdtemp(join(artifacts, 'normalized-'))
    const proof = await normalizePaperclipCaseKernelSources(root, upstreamSource, output, pin)
    expect(proof.commands.map((command) => command.code)).toEqual([0, 0, 0, 0])
    for (const module of pin.modules) {
      expect(await paperclipExternalExecutionSourceDigest(upstreamSource, module.module)).toBe(
        module.sourceSha256
      )
      const generated = await readFile(join(output, module.vendoredModule), 'utf8')
      expect(digest(generated)).toBe(module.sha256)
      expect(generated).toBe(await readFile(join(root, module.vendoredModule), 'utf8'))
      const compiler = {
        loader: 'ts',
        minifySyntax: true,
        minifyWhitespace: true,
        minifyIdentifiers: false
      }
      const raw = await readFile(join(upstreamSource, module.module), 'utf8')
      let runtime = (await transform(raw, compiler)).code
      if (module.module.endsWith('/pipeline-stage-config.ts')) {
        expect(runtime.match(/\.\.\.config\?\?\{\}/g)).toHaveLength(1)
        runtime = runtime.replace('...config??{}', '...config')
      }
      expect((await transform(generated, compiler)).code).toBe(runtime)
    }
    await verifyPaperclipCaseKernelSources(output, manifest)
    await writeFile(join(artifacts, 'normalization-commands.json'), JSON.stringify(proof, null, 2))
  })

  it.skipIf(!upstreamSource)(
    'rejects changed raw input before publishing normalized files',
    async () => {
      await mkdir(artifacts, { recursive: true })
      const input = await mkdtemp(join(artifacts, 'changed-upstream-'))
      const output = await mkdtemp(join(artifacts, 'rejected-normalization-'))
      for (const module of pin.modules) {
        const target = join(input, module.module)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(join(upstreamSource, module.module), target)
      }
      const target = join(input, pin.sourceEntry)
      await writeFile(
        target,
        `${await readFile(target, 'utf8')}\nexport const arbitraryChange = true\n`
      )
      await expect(normalizePaperclipCaseKernelSources(root, input, output, pin)).rejects.toThrow(
        'normalization input differs from the reviewed raw source'
      )
      expect(await readdir(output)).toEqual([])
    }
  )
})

describe.skipIf(!existsSync(join(databaseSource, 'packages/db/package.json')))(
  'Case kernel aliases on the pinned DB source',
  () => {
    it('uses the original schema entry and the same installed Drizzle modules', () => {
      const aliases = paperclipCaseKernelAliases(databaseSource, root)
      for (const [key, target] of Object.entries(paperclipCheckoutAliases(databaseSource))) {
        expect(aliases[key]).toBe(target)
      }
      expect(aliases['@paperclipai/db']).toBe(
        join(databaseSource, 'packages/db/src/schema/index.ts')
      )
      expect(aliases['@hive-paperclip-case-kernel']).toBe(join(root, pin.vendoredEntry))
      expect(manifest.paperclip.revision).toBe('a027f76a726e8a556674eded807c2de0e55f5cc0')
    })

    it('bundles the real facade while removing unused Slack functions and all type-only imports', async () => {
      const compiled = await build({
        absWorkingDir: root,
        entryPoints: [pin.vendoredEntry],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
        metafile: true,
        alias: paperclipCaseKernelAliases(databaseSource, root),
        logLevel: 'silent'
      })
      const inputs = Object.keys(compiled.metafile.inputs)
      const code = compiled.outputFiles[0].text
      expect(inputs.filter((input) => input.includes('/core/case-kernel/'))).toHaveLength(16)
      expect(inputs).toContain(
        'integration/paperclip/core/case-kernel/services/slack-conversation-state.ts'
      )
      expect(
        inputs.some((input) =>
          /\/server\/src\/|adapter-(?:claude|codex|cursor|gemini|grok)|pi-coding-agent|embedded-postgres/.test(
            input
          )
        )
      ).toBe(false)
      expect(inputs.some((input) => /packages\/db\/src\/(?:client|index)\.ts$/.test(input))).toBe(
        false
      )
      expect(code).toContain('visibleIssueCondition')
      for (const symbol of [
        'resumeSlackConversation',
        'nonIdleSlackIssueCondition',
        'externalConversationStateSql'
      ]) {
        expect(code).not.toContain(symbol)
      }
      expect(
        Object.keys(compiled.metafile.outputs).flatMap(
          (key) => compiled.metafile.outputs[key].exports
        )
      ).toEqual([
        'readPipelineCaseInTransaction',
        'reviewCaseInTransaction',
        'transitionCaseInTransaction'
      ])
      await mkdir(artifacts, { recursive: true })
      await writeFile(join(artifacts, 'kernel-bundle-inputs.json'), JSON.stringify(inputs, null, 2))
    })
  }
)
