import { blobBytes } from './upstream-recording-raw.mjs'
import { verifyRecordingCorpus } from './upstream-recording-corpus.mjs'
import {
  adapterInputDigest,
  recorderInputDigest,
  recordingInputEvidence
} from './upstream-recording-inputs.mjs'
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  rmSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  symlinkSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  guardedPath,
  recordingProjection,
  recordingControlProjection,
  exportRecordingControls,
  assertRecordingControls,
  exportRecordingSources,
  assertRecordingFixture,
  decodeRecordingSource,
  decodeRecordingManifest,
  verifyRecordingSource,
  CONTROL_PATHS,
  sha256,
  assertRecordingOutput
} from './upstream-recording-source.mjs'
import { computeUpstreamTreeSync, prepareUpstreamTreeSync } from './upstream-tree-sync.mjs'

const scratch = resolve('logs/upstream-sync/20261015/provenance-implementation/tests')
mkdirSync(scratch, { recursive: true })
function fixture() {
  const root = mkdtempSync(join(scratch, 'repo-'))
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  const write = (path, bytes) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), bytes)
  }
  git('init', '-q')
  git('config', 'core.autocrlf', 'false')
  write('mobile/src/binary.bin', Buffer.from([0, 13, 10, 255]))
  write('mobile/rpc-foundation/extra.ts', 'export {}\n')
  write('src/shared/a.ts', 'export {}\n')
  git('add', '.')
  const tree = git('write-tree')
  return { root, git, write, tree }
}
test('recording digests preserve UTF-16 order and directory traversal', () => {
  const root = 'mobile/src/test-support/rpc-recording'
  const recorderPaths = ['é.ts', 'a.ts', 'Z.ts', 'a/child.ts'].map((name) => `${root}/${name}`)
  const expectedPaths = ['Z.ts', 'a/child.ts', 'a.ts', 'é.ts'].map((name) => `${root}/${name}`)
  const read = (path) => Buffer.from(`body:${String(path)}\r\n`)
  assert.equal(
    recorderInputDigest(recorderPaths, read),
    sha256(expectedPaths.map((path) => `${path}:body:${path}\n`).join('\n'))
  )
  assert.equal(
    adapterInputDigest(['z.ts', 'aa.ts', 'a.ts', 'a-1.ts', 'aa.ts'], read),
    sha256(
      ['a-1.ts', 'a.ts', 'aa.ts', 'z.ts']
        .map((name) => `${name}:body:${root}/adapters/${name}\n`)
        .join('\n')
    )
  )
  assert.throws(() => adapterInputDigest(['../a.ts'], read), /Invalid adapter source domain/)
})

test('guard is the entire current source fence, excluding generated outputs', () => {
  for (const path of [
    'mobile/src/a',
    'src/shared/a',
    'mobile/pnpm-lock.yaml',
    'mobile/rpc-foundation/new-control.ts',
    'mobile/rpc-foundation/pilot-scenarios.json',
    'mobile/scripts/rpc-recording.mts'
  ]) {
    assert.equal(guardedPath(path), true)
  }
  for (const path of [
    'mobile/rpc-foundation/hive/a.ts',
    'mobile/rpc-foundation/goldens/a.json',
    'mobile/rpc-foundation/sub/a.ts',
    '../src/shared/a'
  ]) {
    assert.equal(guardedPath(path), false)
  }
})
test('projection uses Git raw identity; a CRLF checkout cannot change it', () => {
  const f = fixture()
  const before = recordingProjection(f.root, f.tree)
  f.write('src/shared/a.ts', 'export {}\r\n')
  assert.deepEqual(recordingProjection(f.root, f.tree), before)
  assert.throws(() => assertRecordingFixture(f.root, before), /bytes/)
})
test('raw Git projections preserve repository paths from nested recording fixtures', () => {
  const f = fixture()
  const nested = join(f.root, 'logs/raw-fixture')
  mkdirSync(nested, { recursive: true })
  assert.deepEqual(recordingProjection(nested, f.tree), recordingProjection(f.root, f.tree))
})

test('empty blob batches do not invoke Git or authorize missing recording inputs', () => {
  assert.deepEqual(blobBytes(join(scratch, 'does-not-exist'), []), new Map())
  const f = fixture()
  const empty = f.git('hash-object', '-t', 'tree', '--stdin')
  assert.throws(() => recordingProjection(f.root, empty), /Empty guarded/)
  assert.throws(
    () => recordingControlProjection(f.root, empty),
    /Missing or non-regular recording control/
  )
})

test('raw fixture rejects binary normalization, extra and deleted guarded paths', () => {
  const f = fixture()
  const projection = recordingProjection(f.root, f.tree)
  mkdirSync(join(f.root, 'logs'), { recursive: true })
  const output = mkdtempSync(join(f.root, 'logs/export-'))
  exportRecordingSources(f.root, projection, output)
  assertRecordingFixture(output, projection)
  writeFileSync(join(output, 'mobile/src/binary.bin'), Buffer.from([0, 10, 255]))
  assert.throws(() => assertRecordingFixture(output, projection), /bytes/)
  f.write('mobile/src/extra.ts', '')
  assert.throws(() => assertRecordingFixture(f.root, projection), /paths/)
})
test('mode and symlink changes are part of the projection', () => {
  const f = fixture()
  const before = recordingProjection(f.root, f.tree)
  f.git('update-index', '--chmod=+x', 'src/shared/a.ts')
  assert.notEqual(
    recordingProjection(f.root, f.git('write-tree')).guardedSourcesSha256,
    before.guardedSourcesSha256
  )
  const blob = f.git('rev-parse', `${f.tree}:src/shared/a.ts`)
  f.git('update-index', '--cacheinfo', `120000,${blob},src/shared/a.ts`)
  assert.notEqual(
    recordingProjection(f.root, f.git('write-tree')).guardedSourcesSha256,
    before.guardedSourcesSha256
  )
})
test('raw export and fixture verification refuse a linked root or ancestor', () => {
  const f = fixture()
  const projection = recordingProjection(f.root, f.tree)
  mkdirSync(join(f.root, 'logs'), { recursive: true })
  const outside = mkdtempSync(join(scratch, 'outside-'))
  const linked = join(f.root, 'logs/linked')
  symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => exportRecordingSources(f.root, projection, linked), /physical directory/)
  assert.throws(
    () => exportRecordingSources(f.root, projection, join(linked, 'nested')),
    /physical directory/
  )
  assert.throws(() => assertRecordingFixture(linked, projection), /physical directory/)
  assert.deepEqual(readdirSync(outside), [])
})
test('output files cannot redirect a writer through symlinks', () => {
  const f = fixture()
  const output = join(f.root, 'logs/output')
  mkdirSync(output, { recursive: true })
  const outside = mkdtempSync(join(scratch, 'output-outside-'))
  // Junctions also cover the Windows case without needing symlink privilege.
  symlinkSync(outside, join(output, 'goldens'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => assertRecordingOutput(f.root, output, ['goldens']), /symlink/)
  assert.throws(
    () => assertRecordingOutput(f.root, resolve(scratch, '../../../../../unrelated/logs/output')),
    /inside project logs/
  )
})
test(
  'POSIX raw fixtures refuse absolute, escaping and chained source symlinks',
  { skip: process.platform === 'win32' },
  () => {
    for (const target of [
      '/tmp/outside-recording.ts',
      '../../../outside-recording.ts',
      'another-link.ts'
    ]) {
      const f = fixture()
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: f.root,
        input: target,
        encoding: 'utf8'
      }).trim()
      f.git('update-index', '--add', '--cacheinfo', `120000,${blob},mobile/src/link.ts`)
      symlinkSync(target, join(f.root, 'mobile/src/link.ts'))
      const projection = recordingProjection(f.root, f.git('write-tree'))
      assert.throws(() => assertRecordingFixture(f.root, projection), /source symlinks/)
      assert.throws(
        () => exportRecordingSources(f.root, projection, join(f.root, 'logs/export')),
        /source symlinks/
      )
    }
  }
)
test('v3 source cannot be incomplete, mixed, or an ordinary commit writer', () => {
  const source = {
    kind: 'tree-sync-content',
    controlSha: 'a'.repeat(40),
    upstreamSha: 'b'.repeat(40),
    guardVersion: 1,
    guardedSourcesSha256: 'c'.repeat(64),
    guardedFileCount: 3
  }
  assert.deepEqual(decodeRecordingSource(source), source)
  for (const key of Object.keys(source)) {
    const changed = { ...source }
    delete changed[key]
    assert.throws(() => decodeRecordingSource(changed))
  }
  assert.throws(() => decodeRecordingSource({ ...source, baseline: source.controlSha }))
  assert.throws(() => decodeRecordingSource({ ...source, kind: 'commit' }))
  assert.throws(() => decodeRecordingManifest({ version: 3, baseline: source.controlSha }))
})

function chain() {
  const f = fixture()
  f.git('config', 'user.name', 'Provenance Test')
  f.git('config', 'user.email', 'provenance@example.invalid')
  f.git('config', 'commit.gpgsign', 'false')
  f.write('.gitignore', 'logs/\n')
  f.write(
    'mobile/rpc-foundation/pilot-scenarios.json',
    readFileSync('mobile/rpc-foundation/pilot-scenarios.json')
  )
  cpSync('mobile/rpc-foundation/goldens', join(f.root, 'mobile/rpc-foundation/goldens'), {
    recursive: true
  })
  f.git('add', '.')
  f.git('commit', '-qm', 'upstream base')
  const base = f.git('rev-parse', 'HEAD')
  f.git('branch', 'upstream-proof')
  f.git('checkout', '-qb', 'hivecode/main-next')
  for (const path of CONTROL_PATHS) {
    f.write(
      path,
      path.startsWith('config/scripts/') && path.endsWith('.mjs')
        ? readFileSync(path)
        : `frozen control ${path}\n`
    )
  }
  const state = {
    schemaVersion: 1,
    upstream: 'stablyai/orca',
    targetBranch: 'hivecode/main-next',
    initialAuditCompleted: true,
    lastReviewedUpstreamSha: base,
    pendingShas: []
  }
  f.write('config/upstream-sync-state.json', JSON.stringify(state))
  f.write(
    '.gitmodules',
    '[submodule "docs"]\n path = docs\n url = https://example.invalid/private.git\n'
  )
  f.git('add', '.')
  f.git('update-index', '--add', '--cacheinfo', `160000,${'b'.repeat(40)},docs`)
  f.git('commit', '-qm', 'M maintenance controls')
  const control = f.git('rev-parse', 'HEAD')
  f.git('checkout', '-q', 'upstream-proof')
  f.write('src/shared/incoming.ts', 'export const incoming = true\n')
  f.git('add', '.')
  f.git('commit', '-qm', 'upstream source update')
  const upstream = f.git('rev-parse', 'HEAD')
  f.git('checkout', '-q', 'hivecode/main-next')
  const options = { cwd: f.root, target: control, upstream, targetBranch: 'hivecode/main-next' }
  const computed = computeUpstreamTreeSync(options)
  const projection = recordingProjection(f.root, computed.mergedTreeSha)
  const source = {
    kind: 'tree-sync-content',
    controlSha: control,
    upstreamSha: upstream,
    guardVersion: 1,
    guardedSourcesSha256: projection.guardedSourcesSha256,
    guardedFileCount: projection.guardedFileCount
  }
  const corpus = readdirSync(join(f.root, 'mobile/rpc-foundation/goldens'))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map(
      (name) =>
        `${name}:${sha256(
          readFileSync(join(f.root, 'mobile/rpc-foundation/goldens', name), 'utf8').replace(
            /\r\n/g,
            '\n'
          )
        )}`
    )
    .join('\n')
  const upstreamGoldensSha256 = sha256(corpus)
  const inputs = recordingInputEvidence(CONTROL_PATHS, (path) => readFileSync(join(f.root, path)))
  const reviewed = JSON.stringify({ upstreamGoldensSha256, deltas: {} })
  const manifest = {
    version: 3,
    source,
    reviewedDeltasSha256: sha256(reviewed),
    upstreamGoldensSha256,
    ...inputs.digests,
    overlays: {}
  }
  const rows = Object.entries({
    'mobile/rpc-foundation/hive/manifest.json': JSON.stringify(manifest),
    'mobile/rpc-foundation/hive/reviewed-deltas.json': reviewed
  }).map(([path, bytes]) => {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: f.root,
      input: bytes,
      encoding: 'utf8'
    }).trim()
    return {
      path,
      base: null,
      product: null,
      upstream: null,
      result: { mode: '100644', sha: blob },
      reason: 'Reviewed generated recording evidence for exact guarded content',
      regressionTests: ['config/scripts/upstream-recording-source.test.mjs']
    }
  })
  f.write(
    'config/upstream-tree-review.json',
    JSON.stringify({
      schemaVersion: 1,
      kind: 'frozen-upstream-review',
      baseUpstreamSha: base,
      upstreamSha: upstream,
      sourceProductSha: control,
      documentation: null,
      resolutions: rows
    })
  )
  f.git('add', '.')
  f.git('commit', '-qm', 'R freeze reviewed recording results')
  options.target = f.git('rev-parse', 'HEAD')
  prepareUpstreamTreeSync(options)
  f.git('commit', '-qm', 'F verified content')
  const content = f.git('rev-parse', 'HEAD')
  f.write(
    'config/upstream-sync-state.json',
    JSON.stringify({ ...state, lastReviewedUpstreamSha: upstream })
  )
  f.git('add', '.')
  f.git('commit', '-qm', 'checkpoint only')
  options.head = f.git('rev-parse', 'HEAD')
  return { ...f, options, control, content }
}
let verifiedFixture
test(
  'M -> R -> F -> checkpoint verifies without a self-referential commit or relaxed tree receipt',
  { timeout: 180000 },
  () => {
    const f = chain()
    verifiedFixture = f
    const result = verifyRecordingSource(f.options)
    assert.equal(result.controlSha, f.control)
    assert.equal(result.contentCommitSha, f.content)
    assert.equal(result.passed, true)
    f.write('src/shared/late.ts', 'late mutation')
    f.git('add', '.')
    f.git('commit', '-qm', 'forbidden post content change')
    assert.throws(
      () => verifyRecordingSource({ ...f.options, head: f.git('rev-parse', 'HEAD') }),
      /checkpoint|content/i
    )
  }
)

test(
  'a real thin bundle over R reproduces the same content proof without hidden source refs',
  { timeout: 90000 },
  () => {
    const f = verifiedFixture
    assert.ok(f)
    const bundle = join(f.root, 'logs/candidate.bundle')
    mkdirSync(dirname(bundle), { recursive: true })
    f.git('branch', 'recording-candidate', f.options.head)
    f.git('bundle', 'create', bundle, 'refs/heads/recording-candidate', `^${f.options.target}`)
    const imported = fixture()
    imported.git('fetch', '-q', f.root, f.options.target)
    imported.git('fetch', '-q', f.root, f.options.upstream)
    imported.git('bundle', 'verify', bundle)
    imported.git('fetch', '-q', bundle, 'refs/heads/recording-candidate')
    assert.equal(imported.git('rev-parse', 'FETCH_HEAD'), f.options.head)
    assert.equal(
      verifyRecordingSource({ ...f.options, cwd: imported.root }).contentCommitSha,
      f.content
    )
  }
)

test(
  'the real writer, runtime reader and frozen verifier accept the same full-domain artifact',
  { timeout: 180000 },
  () => {
    const f = verifiedFixture
    f.git('checkout', '-q', '--detach', f.content)
    const project = resolve(import.meta.dirname, '../..')
    const evidence = join(f.root, 'logs/real-writer')
    mkdirSync(evidence, { recursive: true })
    const helper = join(evidence, 'write.mts')
    const moduleUrl = (path) => JSON.stringify(pathToFileURL(join(project, path)).href)
    writeFileSync(
      helper,
      `
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { hiveRecordingInputs } from ${moduleUrl('mobile/rpc-foundation/hive-recording-inputs.ts')}
import { writeHiveRecordingOverlay } from ${moduleUrl('mobile/rpc-foundation/write-hive-recording-overlay.ts')}
import { manifestFor } from ${moduleUrl('mobile/rpc-foundation/hive-recording-reference.ts')}
const root = ${JSON.stringify(f.root)}, evidence = ${JSON.stringify(evidence)}
const manifestPath = join(root, 'mobile/rpc-foundation/hive/manifest.json')
const original = readFileSync(manifestPath)
const source = JSON.parse(original.toString()).source
const projection = ${JSON.stringify(recordingProjection(f.root, f.content))}
const controlProjection = ${JSON.stringify(recordingControlProjection(f.root, f.control))}
const inputs = hiveRecordingInputs(root)
const sourceInput = join(evidence, 'source-input.json')
writeFileSync(sourceInput, JSON.stringify({ source, projection, controlProjection }))
writeFileSync(join(evidence, 'provenance.json'), JSON.stringify({ source, ...inputs.digests }))
const recorded = join(evidence, 'goldens'), output = join(evidence, 'hive')
mkdirSync(recorded, { recursive: true }); mkdirSync(output, { recursive: true })
for (const id of inputs.supportedIds) copyFileSync(join(root, 'mobile/rpc-foundation/goldens', id + '.json'), join(recorded, id + '.json'))
copyFileSync(join(root, 'mobile/rpc-foundation/hive/reviewed-deltas.json'), join(output, 'reviewed-deltas.json'))
writeHiveRecordingOverlay(root, sourceInput, recorded, output)
try {
  copyFileSync(join(output, 'manifest.json'), manifestPath)
  if (manifestFor(join(root, 'mobile/rpc-foundation/goldens'))?.version !== 3) throw new Error('Writer output was not accepted by runtime reader')
} finally { writeFileSync(manifestPath, original) }
`
    )
    execFileSync(
      process.execPath,
      ['--conditions=orca-source', join(project, 'node_modules/tsx/dist/cli.mjs'), helper],
      { cwd: project, windowsHide: true }
    )
    f.git('branch', '-m', 'hivecode/main-next', 'preserved-writer')
    f.git('checkout', '-qb', 'hivecode/main-next', f.options.target)
    const review = JSON.parse(
      readFileSync(join(f.root, 'config/upstream-tree-review.json'), 'utf8')
    )
    review.resolutions.find((row) => row.path.endsWith('/manifest.json')).result.sha = f.git(
      'hash-object',
      '-w',
      join(evidence, 'hive/manifest.json')
    )
    f.write('config/upstream-tree-review.json', JSON.stringify(review))
    f.git('add', '.')
    f.git('commit', '-qm', 'Freeze actual writer output')
    const options = { ...f.options, target: f.git('rev-parse', 'HEAD') }
    prepareUpstreamTreeSync(options)
    f.git('commit', '-qm', 'Actual writer content')
    options.head = f.git('rev-parse', 'HEAD')
    assert.equal(verifyRecordingSource(options).passed, true)
  }
)

test(
  'frozen source, upstream, adapter-domain and control tampering fail even with valid tree receipts',
  { timeout: 300000 },
  () => {
    const f = verifiedFixture
    assert.ok(f)
    const cases = [
      [
        'projection',
        (manifest) => {
          manifest.source.guardedSourcesSha256 = '0'.repeat(64)
        },
        /projection/
      ],
      [
        'upstream',
        (manifest) => {
          manifest.source.upstreamSha = f.control
        },
        /upstream identity/
      ],
      [
        'domain',
        (manifest) => {
          delete manifest.adapterSha256ByOperation[
            Object.keys(manifest.adapterSha256ByOperation)[0]
          ]
        },
        /input digests/
      ],
      ['control', null, /control closure/]
    ]
    for (const [name, mutate, expected] of cases) {
      f.git('branch', '-m', `preserved-${String(name)}`)
      f.git('checkout', '-qb', 'hivecode/main-next', f.options.target)
      const review = JSON.parse(
        readFileSync(join(f.root, 'config/upstream-tree-review.json'), 'utf8')
      )
      const row = review.resolutions.find((row) => row.path.endsWith('/manifest.json'))
      if (mutate) {
        const manifest = JSON.parse(f.git('cat-file', 'blob', row.result.sha))
        mutate(manifest)
        row.result.sha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
          cwd: f.root,
          input: JSON.stringify(manifest),
          encoding: 'utf8'
        }).trim()
        f.write('config/upstream-tree-review.json', JSON.stringify(review))
      } else {
        f.write('config/scripts/upstream-recording-controls.mjs', 'changed trusted closure')
      }
      f.git('add', '.')
      f.git('commit', '-qm', `freeze malicious ${String(name)} input`)
      const options = { ...f.options, target: f.git('rev-parse', 'HEAD') }
      prepareUpstreamTreeSync(options)
      f.git('commit', '-qm', `content for ${String(name)}`)
      options.head = f.git('rev-parse', 'HEAD')
      assert.throws(() => verifyRecordingSource(options), expected)
    }
  }
)

test('published raw controls reject self-hashed projections, missing modules and changed dependencies', () => {
  const f = fixture()
  for (const path of CONTROL_PATHS.filter(
    (path) => path.startsWith('config/scripts/') && path.endsWith('.mjs')
  )) {
    f.write(path, readFileSync(path))
  }
  f.git('add', '.')
  const control = f.git('write-tree')
  const projection = recordingControlProjection(f.root, control)
  const output = join(f.root, 'logs/raw-controls')
  exportRecordingControls(f.root, control, projection, output)
  assert.deepEqual(recordingControlProjection(output, control), projection)
  assertRecordingControls(output, control, projection, f.root)
  const forged = structuredClone(projection)
  forged.entries[0].blob = 'a'.repeat(40)
  assert.throws(() => assertRecordingControls(output, control, forged, f.root), /published M/)
  const path = projection.entries[0].path
  writeFileSync(join(output, path), 'import "./evil.mjs"')
  assert.throws(() => assertRecordingControls(output, control, projection, f.root), /bytes/)
  rmSync(join(output, path))
  assert.throws(() => assertRecordingControls(output, control, projection, f.root), /ENOENT/)
})
test('golden ownership preserves eight product-only and forty-six upstream-only changes', () => {
  const entry = (id, blob) => ({
    path: `mobile/rpc-foundation/goldens/${id}.json`,
    mode: '100644',
    blob
  })
  const base = [],
    product = [],
    upstream = [],
    content = []
  for (let index = 0; index < 54; index++) {
    base.push(entry(index, 'base'))
    product.push(entry(index, index < 8 ? 'product' : 'base'))
    upstream.push(entry(index, index < 8 ? 'base' : 'upstream'))
    content.push(entry(index, index < 8 ? 'product' : 'upstream'))
  }
  verifyRecordingCorpus(base, product, upstream, content, [])
  assert.throws(
    () => verifyRecordingCorpus(base, product, upstream, content, [{ path: base[0].path }]),
    /Deterministic/
  )
  const overwrite = structuredClone(content)
  overwrite[0].blob = 'new-recording'
  assert.throws(
    () => verifyRecordingCorpus(base, product, upstream, overwrite, []),
    /Deterministic/
  )
  const conflict = [entry('conflict', 'c')],
    r = [entry('conflict', 'r')],
    u = [entry('conflict', 'u')],
    f = [entry('conflict', 'f')]
  const row = {
    path: conflict[0].path,
    base: { mode: '100644', sha: 'c' },
    product: { mode: '100644', sha: 'r' },
    upstream: { mode: '100644', sha: 'u' },
    result: { mode: '100644', sha: 'f' }
  }
  verifyRecordingCorpus(conflict, r, u, f, [row])
  verifyRecordingCorpus(conflict, r, u, f, [{ ...row, result: { sha: 'f', mode: '100644' } }])
  assert.throws(() => verifyRecordingCorpus(conflict, r, u, f, []), /exact frozen/)
  assert.throws(
    () => verifyRecordingCorpus(conflict, r, u, f, [{ ...row, base: null }]),
    /exact frozen/
  )
  verifyRecordingCorpus([], [], [entry('added', 'u')], [entry('added', 'u')], [])
  verifyRecordingCorpus([entry('deleted', 'c')], [entry('deleted', 'c')], [], [], [])
})
