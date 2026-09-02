import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { lstat, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parseTree, printParseErrorCode } from 'jsonc-parser'
import { resolvePnpmCliInvocation } from './pnpm-cli-invocation.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const DEFAULT_CONTRACT_ROOT = path.join(REPO_ROOT, 'config', 'hiverelay-contract')
const DEFAULT_RECEIPT_PATH = path.join(REPO_ROOT, 'config', 'hiverelay-contract-source.json')
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'config', 'hiverelay-contract-report.json')
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const COMMIT_PATTERN = /^[a-f0-9]{40}$/
const VERDICTS = new Set(['ACCEPT', 'REJECT'])
const FILE_KINDS = new Set(['documentation', 'openapi', 'schema', 'registry', 'fixture'])
const COMPONENTS = new Set(['cloud', 'hivecode', 'cell', 'legacy-orca'])

function assertExactKeys(value, expected, field) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${field} has unknown or missing fields`)
  }
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function rejectDuplicateKeys(node, location) {
  if (node.type === 'object') {
    const keys = new Set()
    for (const property of node.children ?? []) {
      const [keyNode, valueNode] = property.children ?? []
      if (typeof keyNode?.value !== 'string' || !valueNode) {
        throw new Error(`${location} contains a malformed JSON property`)
      }
      if (keys.has(keyNode.value)) {
        throw new Error(`${location} contains duplicate key ${keyNode.value}`)
      }
      keys.add(keyNode.value)
      rejectDuplicateKeys(valueNode, `${location}.${keyNode.value}`)
    }
  } else if (node.type === 'array') {
    for (const [index, child] of (node.children ?? []).entries()) {
      rejectDuplicateKeys(child, `${location}[${index}]`)
    }
  }
}

export function parseStrictJsonDocument(text, field) {
  const errors = []
  const root = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true })
  if (!root || errors.length > 0) {
    const detail = errors[0] ? printParseErrorCode(errors[0].error) : 'InvalidSymbol'
    throw new Error(`${field} is invalid JSON: ${detail}`)
  }
  rejectDuplicateKeys(root, field)
  return JSON.parse(text)
}

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value
}

function assertString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function assertSha256(value, field) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256`)
  }
  return value
}

export function normalizeContractPath(value, field = 'path') {
  const normalized = assertString(value, field).replaceAll('\\', '/')
  if (
    normalized !== value ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`${field} must be a canonical safe relative path: ${value}`)
  }
  return normalized
}

function validateReceipt(value) {
  const receipt = assertObject(value, 'receipt')
  assertExactKeys(
    receipt,
    [
      'schemaVersion',
      'authorityRepository',
      'authorityPath',
      'authoritySourceCommit',
      'contractRevision',
      'manifestSha256',
      'files'
    ],
    'receipt'
  )
  if (receipt.schemaVersion !== 1) {
    throw new Error('receipt.schemaVersion must be 1')
  }
  if (receipt.authorityRepository !== 'hive-cloud') {
    throw new Error('receipt.authorityRepository must be hive-cloud')
  }
  if (receipt.authorityPath !== 'docs/hive/contracts/hiverelay-v2') {
    throw new Error('receipt.authorityPath must name the canonical HiveCloud contract path')
  }
  const authoritySourceCommit = assertString(
    receipt.authoritySourceCommit,
    'receipt.authoritySourceCommit'
  )
  if (!COMMIT_PATTERN.test(authoritySourceCommit)) {
    throw new Error('receipt.authoritySourceCommit must be a full lowercase Git commit')
  }
  const contractRevision = assertString(receipt.contractRevision, 'receipt.contractRevision')
  const manifestSha256 = assertSha256(receipt.manifestSha256, 'receipt.manifestSha256')
  if (!Array.isArray(receipt.files) || receipt.files.length === 0) {
    throw new Error('receipt.files must be a non-empty array')
  }
  const files = receipt.files.map((entry, index) => {
    const file = assertObject(entry, `receipt.files[${index}]`)
    assertExactKeys(file, ['path', 'sha256'], `receipt.files[${index}]`)
    return {
      path: normalizeContractPath(file.path, `receipt.files[${index}].path`),
      sha256: assertSha256(file.sha256, `receipt.files[${index}].sha256`)
    }
  })
  const paths = files.map((file) => file.path)
  const sorted = [...paths].sort()
  if (paths.some((filePath, index) => filePath !== sorted[index])) {
    throw new Error('receipt.files must be sorted by canonical path')
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error('receipt.files contains a duplicate path')
  }
  return {
    schemaVersion: 1,
    authorityRepository: receipt.authorityRepository,
    authorityPath: receipt.authorityPath,
    authoritySourceCommit,
    contractRevision,
    manifestSha256,
    files
  }
}

function validateFixtureManifest(value, contractRevision) {
  const manifest = assertObject(value, 'fixture manifest')
  assertExactKeys(manifest, ['schemaVersion', 'contractRevision', 'files'], 'fixture manifest')
  if (manifest.schemaVersion !== 1) {
    throw new Error('fixture manifest schemaVersion must be 1')
  }
  if (manifest.contractRevision !== contractRevision) {
    throw new Error('fixture manifest contractRevision does not match receipt')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('fixture manifest files must be a non-empty array')
  }
  const caseIds = new Set()
  const filePaths = new Set()
  const files = manifest.files.map((entry, index) => {
    const file = assertObject(entry, `fixture manifest files[${index}]`)
    const kind = assertString(file.kind, `fixture manifest files[${index}].kind`)
    if (!FILE_KINDS.has(kind)) {
      throw new Error(`fixture manifest files[${index}].kind is invalid`)
    }
    const expectedKeys = ['path', 'kind', 'applicableComponents', 'sha256']
    if (kind === 'fixture') {
      expectedKeys.push('caseId', 'expectedVerdict', 'expectedReason')
    }
    assertExactKeys(file, expectedKeys, `fixture manifest files[${index}]`)
    const filePath = normalizeContractPath(file.path, `fixture manifest files[${index}].path`)
    if (filePath === 'fixture-manifest.json') {
      throw new Error('fixture manifest must not hash itself')
    }
    if (!Array.isArray(file.applicableComponents) || file.applicableComponents.length === 0) {
      throw new Error(`fixture manifest files[${index}].applicableComponents must not be empty`)
    }
    const applicableComponents = file.applicableComponents.map((component, componentIndex) => {
      const parsed = assertString(
        component,
        `fixture manifest files[${index}].applicableComponents[${componentIndex}]`
      )
      if (!COMPONENTS.has(parsed)) {
        throw new Error(`fixture manifest file ${filePath} has an invalid component`)
      }
      return parsed
    })
    if (new Set(applicableComponents).size !== applicableComponents.length) {
      throw new Error(`fixture manifest file ${filePath} has duplicate applicable components`)
    }
    if (filePaths.has(filePath)) {
      throw new Error(`fixture manifest contains duplicate path: ${filePath}`)
    }
    filePaths.add(filePath)
    const result = {
      path: filePath,
      kind,
      applicableComponents,
      sha256: assertSha256(file.sha256, `fixture manifest file ${filePath}.sha256`)
    }
    if (kind !== 'fixture') {
      return result
    }
    if (!filePath.startsWith('fixtures/') || !filePath.endsWith('.json')) {
      throw new Error(`fixture manifest fixture has an invalid path: ${filePath}`)
    }
    const caseId = assertString(file.caseId, `fixture manifest file ${filePath}.caseId`)
    if (caseIds.has(caseId)) {
      throw new Error(`fixture manifest contains duplicate caseId: ${caseId}`)
    }
    if (!VERDICTS.has(file.expectedVerdict)) {
      throw new Error(`fixture manifest case ${caseId} has an invalid expectedVerdict`)
    }
    caseIds.add(caseId)
    return {
      ...result,
      caseId,
      expectedVerdict: file.expectedVerdict,
      expectedReason: assertString(file.expectedReason, `fixture manifest case ${caseId}.reason`)
    }
  })
  return { schemaVersion: 1, contractRevision, files }
}

async function collectContractFiles(root) {
  const files = []
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const stat = await lstat(absolutePath)
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
      normalizeContractPath(relativePath, 'vendored contract path')
      if (stat.isSymbolicLink()) {
        throw new Error(`Vendored contract must not contain symlinks: ${relativePath}`)
      }
      if (stat.isDirectory()) {
        await visit(absolutePath)
      } else if (stat.isFile()) {
        files.push(relativePath)
      } else {
        throw new Error(`Vendored contract contains a special file: ${relativePath}`)
      }
    }
  }
  await visit(root)
  return files.sort()
}

export async function verifyHiveRelayContract({
  contractRoot = DEFAULT_CONTRACT_ROOT,
  receiptPath = DEFAULT_RECEIPT_PATH
} = {}) {
  const receipt = validateReceipt(
    parseStrictJsonDocument(await readFile(receiptPath, 'utf8'), 'receipt')
  )
  const actualPaths = await collectContractFiles(contractRoot)
  const receiptPaths = receipt.files.map((file) => file.path)
  if (actualPaths.length !== receiptPaths.length) {
    throw new Error('Vendored contract file set does not match receipt')
  }
  for (const [index, actualPath] of actualPaths.entries()) {
    if (actualPath !== receiptPaths[index]) {
      throw new Error(`Vendored contract file set differs at ${actualPath}`)
    }
  }
  const hashes = new Map()
  for (const file of receipt.files) {
    const digest = sha256Bytes(await readFile(path.join(contractRoot, file.path)))
    if (digest !== file.sha256) {
      throw new Error(`Vendored contract digest mismatch: ${file.path}`)
    }
    hashes.set(file.path, digest)
  }
  const manifestPath = 'fixture-manifest.json'
  if (hashes.get(manifestPath) !== receipt.manifestSha256) {
    throw new Error('Vendored fixture manifest digest does not match authority receipt')
  }
  const manifest = validateFixtureManifest(
    parseStrictJsonDocument(
      await readFile(path.join(contractRoot, manifestPath), 'utf8'),
      'fixture manifest'
    ),
    receipt.contractRevision
  )
  const listedPaths = manifest.files.map((file) => file.path).sort()
  const vendoredWithoutManifest = actualPaths.filter((file) => file !== manifestPath)
  if (
    listedPaths.length !== vendoredWithoutManifest.length ||
    listedPaths.some((file, index) => file !== vendoredWithoutManifest[index])
  ) {
    throw new Error('Fixture manifest file set does not match vendored contract')
  }
  for (const file of manifest.files) {
    if (hashes.get(file.path) !== file.sha256) {
      throw new Error(`Contract file digest does not match manifest: ${file.path}`)
    }
  }
  const fixtureCases = manifest.files.filter((fixture) => fixture.kind === 'fixture')
  const applicableCases = fixtureCases.filter((fixture) =>
    fixture.applicableComponents.some((component) => component.toLowerCase() === 'hivecode')
  )
  if (applicableCases.length === 0) {
    throw new Error('Fixture manifest has zero HiveCode-applicable cases')
  }
  return { receipt, manifest, fixtureCases, applicableCases }
}

async function main() {
  const result = await verifyHiveRelayContract()
  const runReportPath = `${DEFAULT_REPORT_PATH}.${process.pid}-${randomUUID()}.tmp`
  await rm(runReportPath, { force: true })
  const pnpm = resolvePnpmCliInvocation()
  const testFiles = [
    'config/scripts/verify-hiverelay-contract.test.mjs',
    'tests/e2e/hiverelay/hiverelay-contract-fixtures.unit.test.ts',
    'tests/e2e/hiverelay/hiverelay-contract-jws.unit.test.ts',
    'tests/e2e/hiverelay/hiverelay-contract-origin.unit.test.ts',
    'tests/e2e/hiverelay/hiverelay-contract-state-rules.unit.test.ts',
    'tests/e2e/hiverelay/hiverelay-test-wire.unit.test.ts',
    'tests/e2e/hiverelay/hiverelay-testkit.unit.test.ts',
    'tests/e2e/hiverelay/hiverelay-testkit-boundary.unit.test.ts'
  ]
  try {
    const tested = spawnSync(
      pnpm.command,
      [
        ...pnpm.prefixArgs,
        'exec',
        'vitest',
        'run',
        '--config',
        'config/vitest.config.ts',
        ...testFiles
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, HIVERELAY_CONTRACT_REPORT_PATH: runReportPath },
        shell: pnpm.shell,
        stdio: 'inherit'
      }
    )
    if (tested.error) {
      throw tested.error
    }
    if (tested.status !== 0) {
      throw new Error(`HiveRelay TypeScript contract suite failed with exit ${tested.status}`)
    }
    const report = assertObject(JSON.parse(await readFile(runReportPath, 'utf8')), 'report')
    const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    }).trim()
    if (
      report.status !== 'PASS' ||
      report.component !== 'hivecode-typescript' ||
      report.commit !== currentCommit ||
      report.contractRevision !== result.receipt.contractRevision ||
      report.manifestSha256 !== result.receipt.manifestSha256 ||
      report.testCount !== result.applicableCases.length ||
      report.resultCount !== result.fixtureCases.length ||
      report.applicableFixtureCount !== result.applicableCases.length ||
      !Array.isArray(report.results) ||
      report.results.length !== report.resultCount
    ) {
      throw new Error('Generated HiveRelay contract report does not match the verified inputs')
    }
    await rename(runReportPath, DEFAULT_REPORT_PATH)
  } finally {
    await rm(runReportPath, { force: true })
  }
  console.log(
    `HiveRelay contract integrity passed: revision=${result.receipt.contractRevision} ` +
      `files=${result.receipt.files.length} hivecodeCases=${result.applicableCases.length} ` +
      `report=${path.relative(REPO_ROOT, DEFAULT_REPORT_PATH)}`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
