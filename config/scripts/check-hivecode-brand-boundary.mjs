import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const DEFAULT_ALLOWLIST_PATH = path.join(REPO_ROOT, 'config', 'hivecode-brand-allowlist.json')
const DEFAULT_PRODUCT_MANIFEST_PATH = path.join(
  REPO_ROOT,
  'config',
  'product',
  'hivecode.product.json'
)
const REQUIRED_PROTECTED_FILES = ['.gitignore', '.gitattributes']
const GIT_FILE_LIST_MAX_BUFFER = 16 * 1024 * 1024

export function loadCanonicalBrandLiteral(manifestPath = DEFAULT_PRODUCT_MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    typeof manifest.slug !== 'string' ||
    !/^[a-z0-9][a-z0-9-]*$/.test(manifest.slug)
  ) {
    throw new Error('Product manifest slug must be a canonical lowercase product literal')
  }
  return manifest.slug
}

const BRAND_LITERAL = loadCanonicalBrandLiteral()

export function normalizeRepoPath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '')
}

function assertSafeRepoPath(filePath, field) {
  if (
    !filePath ||
    filePath.startsWith('/') ||
    /^[A-Za-z]:\//.test(filePath) ||
    filePath.split('/').includes('..')
  ) {
    throw new Error(`${field} contains an unsafe repository path: ${filePath}`)
  }
}

export function validateAllowlist(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Brand allowlist must be a JSON object')
  }
  if (value.schemaVersion !== 2) {
    throw new Error('Brand allowlist schemaVersion must be 2')
  }
  if (typeof value.literal !== 'string' || value.literal.trim() === '') {
    throw new Error('Brand allowlist literal must be a non-empty string')
  }
  if (value.literal !== BRAND_LITERAL) {
    throw new Error(`Brand allowlist literal must be '${BRAND_LITERAL}'`)
  }
  if (!Array.isArray(value.allowedFiles)) {
    throw new Error('Brand allowlist allowedFiles must be an array')
  }

  const allowedFiles = value.allowedFiles.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`allowedFiles[${index}] must be a string`)
    }
    const normalized = normalizeRepoPath(entry)
    assertSafeRepoPath(normalized, `allowedFiles[${index}]`)
    return normalized
  })
  const duplicate = allowedFiles.find((entry, index) => allowedFiles.indexOf(entry) !== index)
  if (duplicate) {
    throw new Error(`Brand allowlist contains duplicate path: ${duplicate}`)
  }
  const sorted = [...allowedFiles].sort((left, right) => left.localeCompare(right, 'en'))
  if (allowedFiles.some((entry, index) => entry !== sorted[index])) {
    throw new Error('Brand allowlist allowedFiles must be sorted')
  }

  const protectedFileHashes = {}
  if (value.protectedFileHashes !== undefined) {
    if (
      !value.protectedFileHashes ||
      typeof value.protectedFileHashes !== 'object' ||
      Array.isArray(value.protectedFileHashes)
    ) {
      throw new Error('Brand allowlist protectedFileHashes must be an object')
    }
    for (const [rawPath, hash] of Object.entries(value.protectedFileHashes)) {
      const filePath = normalizeRepoPath(rawPath)
      assertSafeRepoPath(filePath, `protectedFileHashes.${rawPath}`)
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
        throw new Error(`Brand allowlist protected hash must be lowercase SHA-256: ${filePath}`)
      }
      protectedFileHashes[filePath] = hash
    }
  }
  for (const requiredPath of REQUIRED_PROTECTED_FILES) {
    if (!Object.hasOwn(protectedFileHashes, requiredPath)) {
      throw new Error(`Brand allowlist ${requiredPath} must be protected`)
    }
  }

  return {
    schemaVersion: 2,
    literal: value.literal,
    allowedFiles,
    protectedFileHashes
  }
}

export function normalizedTextSha256(text) {
  return createHash('sha256')
    .update(text.replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
    .digest('hex')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchingLineNumbers(text, pattern) {
  const matches = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    pattern.lastIndex = 0
    if (pattern.test(line)) {
      matches.push(index + 1)
    }
  }
  return matches
}

export function scanBrandBoundary({ files, allowlist, readText }) {
  const parsedAllowlist = validateAllowlist(allowlist)
  const allowed = new Set(parsedAllowlist.allowedFiles)
  const pattern = new RegExp(escapeRegExp(parsedAllowlist.literal), 'i')
  const literalFiles = []
  const violations = []
  const seen = new Set()
  const protectedFileHashes = new Map(Object.entries(parsedAllowlist.protectedFileHashes))
  const changedProtectedFiles = new Set(protectedFileHashes.keys())

  for (const rawPath of files) {
    const filePath = normalizeRepoPath(rawPath)
    assertSafeRepoPath(filePath, 'repository file')
    let text
    try {
      text = readText(filePath)
    } catch (error) {
      throw new Error(
        `Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    const expectedHash = protectedFileHashes.get(filePath)
    if (expectedHash && normalizedTextSha256(text) === expectedHash) {
      changedProtectedFiles.delete(filePath)
    }
    if (text.includes('\0')) {
      continue
    }

    pattern.lastIndex = 0
    const pathMatches = pattern.test(filePath)
    const lineNumbers = matchingLineNumbers(text, pattern)
    if (!pathMatches && lineNumbers.length === 0) {
      continue
    }

    seen.add(filePath)
    const finding = { path: filePath, pathMatches, lineNumbers }
    literalFiles.push(finding)
    if (!allowed.has(filePath)) {
      violations.push(finding)
    }
  }

  const staleAllowedFiles = parsedAllowlist.allowedFiles.filter((filePath) => !seen.has(filePath))
  return {
    literalFiles,
    violations,
    staleAllowedFiles,
    changedProtectedFiles: [...changedProtectedFiles]
  }
}

function listRepositoryFiles(root) {
  const env = { ...process.env }
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
    delete env[name]
  }
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--stage', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      env,
      maxBuffer: GIT_FILE_LIST_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  )
  return output
    .split('\0')
    .filter(Boolean)
    .filter((entry) => !/^160000 [a-f0-9]+ [0-3]\t/.test(entry))
    .map((entry) => entry.replace(/^\d{6} [a-f0-9]+ [0-3]\t/, ''))
    .filter((filePath) => existsSync(path.join(root, filePath)))
}

function loadAllowlist(allowlistPath) {
  const raw = JSON.parse(readFileSync(allowlistPath, 'utf8'))
  return validateAllowlist(raw)
}

export function checkBrandBoundary({
  root = REPO_ROOT,
  allowlistPath = DEFAULT_ALLOWLIST_PATH
} = {}) {
  const allowlist = loadAllowlist(allowlistPath)
  const files = listRepositoryFiles(root)
  return scanBrandBoundary({
    files,
    allowlist,
    readText: (filePath) => readFileSync(path.join(root, filePath), 'utf8')
  })
}

function formatFinding(finding) {
  const locations = []
  if (finding.pathMatches) {
    locations.push('path')
  }
  if (finding.lineNumbers.length > 0) {
    locations.push(`lines ${finding.lineNumbers.join(',')}`)
  }
  return `  - ${finding.path} (${locations.join('; ')})`
}

function main() {
  const result = checkBrandBoundary()
  if (
    result.violations.length > 0 ||
    result.staleAllowedFiles.length > 0 ||
    result.changedProtectedFiles.length > 0
  ) {
    if (result.violations.length > 0) {
      console.error('Unallowlisted product-brand literals found:')
      for (const finding of result.violations) {
        console.error(formatFinding(finding))
      }
    }
    if (result.staleAllowedFiles.length > 0) {
      console.error('Stale brand allowlist entries must be removed:')
      for (const filePath of result.staleAllowedFiles) {
        console.error(`  - ${filePath}`)
      }
    }
    if (result.changedProtectedFiles.length > 0) {
      console.error('Protected boundary files changed; update requires explicit policy review:')
      for (const filePath of result.changedProtectedFiles) {
        console.error(`  - ${filePath}`)
      }
    }
    process.exitCode = 1
    return
  }

  console.log(
    `Brand boundary check passed: ${result.literalFiles.length} literal-bearing files are explicitly allowlisted.`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
