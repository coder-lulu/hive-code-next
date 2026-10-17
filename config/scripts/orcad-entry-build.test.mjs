import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildOrcadEntry, ORCAD_COMMONJS_MODULE_OPTIONS } from './orcad-entry-build.mjs'
import { runProcessSync } from '@orca/process-host'
import ts from 'typescript-api'

const directory = mkdtempSync(join(tmpdir(), 'orca-structured-provider-build-'))
const bundle = join(directory, 'orcad-server.js')
let serverMetafile

beforeAll(async () => {
  serverMetafile = (await buildOrcadEntry(bundle)).metafile
}, 60_000)

afterAll(() => {
  rmSync(directory, { recursive: true, force: true })
})

it('emits the Grok hash implementation inside the actual standalone server bundle', () => {
  const inputs = Object.keys(serverMetafile.inputs)
  expect(inputs).toContain('src/shared/grok-session-paths.ts')
  for (const module of ['blake3', 'utils']) {
    const hashInputs = inputs.filter((input) => input.endsWith(`/@noble/hashes/esm/${module}.js`))
    expect(hashInputs).toHaveLength(1)
    const emittedBytes = Object.values(serverMetafile.outputs).reduce(
      (total, output) => total + (output.inputs[hashInputs[0]]?.bytesInOutput ?? 0),
      0
    )
    expect(emittedBytes).toBeGreaterThan(0)
  }
  expect(
    Object.values(serverMetafile.outputs).flatMap((output) =>
      output.imports.filter((entry) => entry.external && entry.path.startsWith('@noble/'))
    )
  ).toEqual([])
})

it('builds the actual WSL hook relay with only builtin external dependencies', () => {
  const outputRoot = join(directory, 'wsl-build')
  const built = runProcessSync({
    program: process.execPath,
    args: [join(import.meta.dirname, 'build-wsl-guest.mjs')],
    cwd: join(import.meta.dirname, '..', '..'),
    env: { ORCA_BACKGROUND_LAUNCH: '1', ORCA_WSL_GUEST_OUT_ROOT: outputRoot },
    timeoutMs: 60_000
  })
  expect(built.code, built.stderr).toBe(0)
  const source = ts.createSourceFile(
    'wsl-agent-hook-relay.js',
    readFileSync(join(outputRoot, 'wsl', 'wsl-agent-hook-relay.js'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  const dependencies = []
  function visit(node) {
    expect(ts.isImportDeclaration(node)).toBe(false)
    expect(ts.isExportDeclaration(node)).toBe(false)
    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      expect(node.arguments).toHaveLength(1)
      expect(ts.isStringLiteral(node.arguments[0])).toBe(true)
      dependencies.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(dependencies.length).toBeGreaterThan(0)
  expect(dependencies.filter((dependency) => !isBuiltin(dependency))).toEqual([])
}, 70_000)

it('loads the structured Claude SDK through the packaged server under plain Node', () => {
  const loaded = runProcessSync({
    program: process.execPath,
    args: [bundle, '--orcad-structured-provider-load-check'],
    cwd: directory,
    env: { ORCA_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 30_000
  })
  expect(loaded.code, loaded.stderr.slice(-2_000)).toBe(0)
}, 40_000)

it('resolves bundle-relative requires after deployment to a path with URL-special characters', async () => {
  const buildDirectory = join(directory, 'build')
  mkdirSync(buildDirectory)
  const outfile = join(buildDirectory, 'entry.cjs')
  await build({
    ...ORCAD_COMMONJS_MODULE_OPTIONS,
    stdin: {
      contents: `import { createRequire } from 'node:module';
        console.log(createRequire(import.meta.url)('./asset.cjs'));`,
      resolveDir: directory
    },
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile,
    minify: true,
    logLevel: 'error'
  })
  writeFileSync(join(buildDirectory, 'asset.cjs'), 'module.exports = "deployed asset"')
  const deployedDirectory = join(directory, 'deployed # 100%')
  renameSync(buildDirectory, deployedDirectory)
  const loaded = runProcessSync({
    program: process.execPath,
    args: [join(deployedDirectory, 'entry.cjs')],
    cwd: directory,
    env: { ORCA_BACKGROUND_LAUNCH: '1' },
    timeoutMs: 30_000
  })
  expect(loaded.code, loaded.stderr).toBe(0)
  expect(loaded.stdout.trim()).toBe('deployed asset')
})

it.each(['import.meta', 'import.meta.dirname', 'import.meta.filename', 'import.meta.resolve'])(
  'rejects unsupported %s instead of silently replacing it with an empty object',
  async (expression) => {
    await expect(
      build({
        ...ORCAD_COMMONJS_MODULE_OPTIONS,
        stdin: { contents: `console.log(${expression})`, resolveDir: directory },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        write: false,
        logLevel: 'silent'
      })
    ).rejects.toThrow('"import.meta" is not available')
  }
)
