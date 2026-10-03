import { execFileSync } from 'node:child_process'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const POLICY_PATH = 'config/private-document-fingerprints.json'
const PRIVATE_URLS = new Set([
  'https://github.com/coder-lulu/hive-code-docs.git',
  'git@github.com:coder-lulu/hive-code-docs.git'
])
const SHA = /^[a-f0-9]{40}$/
const DESIGN_SECTIONS = [
  '## 1. 文档权威与维护规则',
  '## 3. 当前能力基线',
  '## 4. 总体架构',
  '## 5. 功能设计',
  '## 7. 开发路线',
  '## 10. 已合并资料处置'
]
const PRIVATE_DESIGN_MARKER = /^#\s+(?:HiveCode\s+)?(?:产品总设计|产品设计|Product Design)\s*$/im

function normalizeRepoPath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '')
}

function validPolicy(policy) {
  return (
    policy?.schemaVersion === 1 &&
    policy.algorithm === 'git-blob-sha1' &&
    SHA.test(policy.sourceCommit) &&
    policy.sourceCommit !== '0'.repeat(40) &&
    Array.isArray(policy.blobs) &&
    policy.blobs.length > 0 &&
    policy.blobs.every(
      (blob, index) =>
        SHA.test(blob) && blob !== '0'.repeat(40) && (index === 0 || policy.blobs[index - 1] < blob)
    )
  )
}

export function verifyDocumentationGovernance({
  entries = [],
  submodules = [],
  fingerprints,
  files = [],
  readText
}) {
  const errors = []
  const docs = entries.filter((entry) => normalizeRepoPath(entry.path) === 'docs')
  if (
    docs.length !== 1 ||
    docs[0].mode !== '160000' ||
    docs[0].stage !== 0 ||
    !SHA.test(docs[0].objectSha) ||
    docs[0].objectSha === '0'.repeat(40)
  ) {
    errors.push('docs must be exactly one pinned stage-0 Git submodule (mode 160000)')
  }
  const bindings = submodules.filter((module) => module.path === 'docs')
  if (
    bindings.length !== 1 ||
    !PRIVATE_URLS.has(bindings[0].url) ||
    submodules.filter((module) => PRIVATE_URLS.has(module.url)).length !== 1
  ) {
    errors.push('docs must bind exactly once to the private coder-lulu/hive-code-docs repository')
  }
  for (const required of ['.gitmodules', POLICY_PATH]) {
    const record = entries.filter((entry) => entry.path === required)
    if (
      record.length !== 1 ||
      !['100644', '100755'].includes(record[0].mode) ||
      record[0].stage !== 0
    ) {
      errors.push(
        required === POLICY_PATH
          ? 'Private document fingerprint policy must be tracked as a regular public file'
          : '.gitmodules must be tracked as a regular public file'
      )
    }
  }
  const policyValid = validPolicy(fingerprints)
  if (!policyValid) {
    errors.push('Private document fingerprint policy is missing, empty or invalid')
  }
  const privateBlobs = new Set(policyValid ? fingerprints.blobs : [])
  const publicPaths = new Set()
  for (const entry of entries) {
    const filePath = normalizeRepoPath(entry.path)
    if (filePath.startsWith('docs/')) {
      errors.push(`Private documentation must not be tracked in the public repository: ${filePath}`)
      continue
    }
    if (filePath === 'docs') {
      continue
    }
    if (privateBlobs.has(entry.objectSha)) {
      errors.push(`Private document body is duplicated in a public file: ${filePath}`)
    }
    if (['100644', '100755'].includes(entry.mode) && entry.stage === 0) {
      publicPaths.add(filePath)
    }
  }
  for (const rawPath of files) {
    const filePath = normalizeRepoPath(rawPath)
    if (!publicPaths.has(filePath)) {
      continue
    }
    const text = readText(filePath)
    if (typeof text !== 'string') {
      throw new Error(`Could not read public marker candidate: ${filePath}`)
    }
    const sections = new Set(text.split(/\r?\n/).map((line) => line.trim()))
    if (
      DESIGN_SECTIONS.every((section) => sections.has(section)) ||
      PRIVATE_DESIGN_MARKER.test(text)
    ) {
      errors.push(`Internal product design prose must remain private: ${filePath}`)
    }
  }
  return errors
}

export function parseTrackedEntries(output) {
  return output
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const match = /^(\d{6}) ([a-f0-9]{40}) ([0-3])\t([\s\S]+)$/.exec(row)
      if (!match) {
        throw new Error('Malformed staged Git file entry')
      }
      return { mode: match[1], objectSha: match[2], stage: Number(match[3]), path: match[4] }
    })
}

function createGit(root) {
  const env = { ...process.env }
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
    delete env[name]
  }
  return (args, allowNoMatches = false) => {
    try {
      return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        env,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      if (allowNoMatches && error.status === 1) {
        return ''
      }
      throw error
    }
  }
}

function parseSubmodules(output) {
  const modules = new Map()
  for (const row of output.split('\0').filter(Boolean)) {
    const separator = row.indexOf('\n')
    const match = /^submodule\.(.+)\.(path|url)$/.exec(row.slice(0, separator))
    if (separator === -1 || !match) {
      throw new Error('Malformed staged submodule binding')
    }
    const module = modules.get(match[1]) ?? {}
    if (Object.hasOwn(module, match[2])) {
      throw new Error('Duplicate staged submodule binding field')
    }
    module[match[2]] = row.slice(separator + 1)
    modules.set(match[1], module)
  }
  return [...modules.values()]
}

export function checkDocumentationGovernance(root = REPO_ROOT) {
  const git = createGit(root)
  const entries = parseTrackedEntries(git(['ls-files', '--stage', '-z']))
  const regular = (filePath) =>
    entries.find(
      (entry) =>
        entry.path === filePath && entry.stage === 0 && ['100644', '100755'].includes(entry.mode)
    )
  const policy = regular(POLICY_PATH)
  const modules = regular('.gitmodules')
  const fingerprints = policy ? JSON.parse(git(['cat-file', 'blob', policy.objectSha])) : null
  const submodules = modules
    ? parseSubmodules(
        git(
          [
            'config',
            '--null',
            '--blob',
            modules.objectSha,
            '--get-regexp',
            String.raw`^submodule\..*\.(path|url)$`
          ],
          true
        )
      )
    : []
  // Index fingerprints cover every extension; prose markers only need public narrative blobs.
  const markerPatterns = [
    ...DESIGN_SECTIONS.map((section) => `^${section.replaceAll('.', '\\.')}[[:space:]]*$`),
    '^#[[:space:]]+(HiveCode[[:space:]]+)?(产品总设计|产品设计|Product Design)[[:space:]]*$'
  ]
  const candidates = git(
    [
      'grep',
      '--cached',
      '--files-with-matches',
      '--null',
      '--extended-regexp',
      ...markerPatterns.flatMap((pattern) => ['-e', pattern]),
      '--',
      ...['md', 'mdx', 'html', 'htm'].map((extension) => `:(glob)**/*.${extension}`),
      ':(exclude)docs',
      ':(exclude)docs/**'
    ],
    true
  )
    .split('\0')
    .filter(Boolean)
  if (candidates.length > 64) {
    throw new Error('Too many public internal-design marker candidates')
  }
  return verifyDocumentationGovernance({
    entries,
    submodules,
    fingerprints,
    files: candidates,
    readText: (filePath) => {
      const entry = regular(filePath)
      if (!entry) {
        throw new Error('Public marker candidate is not a regular index file')
      }
      return git(['cat-file', 'blob', entry.objectSha])
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const errors = checkDocumentationGovernance()
    if (errors.length) {
      console.error('Private documentation boundary check failed:')
      for (const error of errors) {
        console.error(`  - ${error}`)
      }
      process.exitCode = 1
    } else {
      console.log(
        'Private documentation boundary passed: docs is the pinned private submodule; public prose fingerprints and design markers are clear.'
      )
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
