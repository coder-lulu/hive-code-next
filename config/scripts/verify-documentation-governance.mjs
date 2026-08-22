import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')

export const CANONICAL_PRODUCT_DESIGN = 'docs/engineering/product-design.md'

export const CONSOLIDATED_DOCUMENTS = [
  'docs/agent-skill-sharing-implementation-checklist.md',
  'docs/agent-skill-sharing-installation-plan.md',
  'docs/ai-vault-process-isolation-plan.md',
  'docs/engineering/fork-delta-baseline.md',
  'docs/mobile-relay-ux-findings.md',
  'mobile/issue-5049-unresponsive-session-findings.md',
  'mobile/mobile-terminal-direct-input-default.md',
  'mobile/mock-homepage.html',
  'mobile/mock-tasks.html',
  'mobile/terminal-output-streaming-findings.md',
  'tests/e2e/ssh-config-host-picker.PLAN.md'
]

const REQUIRED_DESIGN_SECTIONS = [
  '## 1. 文档权威与维护规则',
  '## 3. 当前能力基线',
  '## 4. 总体架构',
  '## 5. 功能设计',
  '## 7. 开发路线',
  '## 10. 已合并资料处置'
]

const PARALLEL_DOCUMENT_PATTERN =
  /(?:^|[-_.])(plan|checklist|findings|draft|final|revised|new|copy|v\d+)(?=[-_.]|$)/i

function normalizeRepoPath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '')
}

function isGovernedMarkdown(filePath) {
  if (!filePath.toLowerCase().endsWith('.md')) {
    return false
  }
  return (
    filePath.startsWith('docs/') ||
    filePath.startsWith('mobile/') ||
    filePath.startsWith('tests/e2e/')
  )
}

export function verifyDocumentationGovernance({ files, readText }) {
  const normalizedFiles = files.map(normalizeRepoPath)
  const fileSet = new Set(normalizedFiles)
  const errors = []

  if (!fileSet.has(CANONICAL_PRODUCT_DESIGN)) {
    errors.push(`Missing canonical product design: ${CANONICAL_PRODUCT_DESIGN}`)
  } else {
    const design = readText(CANONICAL_PRODUCT_DESIGN)
    for (const section of REQUIRED_DESIGN_SECTIONS) {
      if (!design.includes(section)) {
        errors.push(`Canonical product design is missing section: ${section}`)
      }
    }
  }

  if (!fileSet.has('README.md')) {
    errors.push('Missing repository README.md')
  } else if (!readText('README.md').includes(`(${CANONICAL_PRODUCT_DESIGN})`)) {
    errors.push(`README.md must link to ${CANONICAL_PRODUCT_DESIGN}`)
  }

  for (const filePath of CONSOLIDATED_DOCUMENTS) {
    if (fileSet.has(filePath)) {
      errors.push(`Consolidated historical document must not return: ${filePath}`)
    }
  }

  for (const filePath of normalizedFiles) {
    if (!isGovernedMarkdown(filePath) || filePath === CANONICAL_PRODUCT_DESIGN) {
      continue
    }
    if (PARALLEL_DOCUMENT_PATTERN.test(path.posix.basename(filePath))) {
      errors.push(`Parallel plan/version document is not allowed: ${filePath}`)
    }
  }

  return errors
}

function listRepositoryFiles(root) {
  const env = { ...process.env }
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
    delete env[name]
  }
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
    .split('\0')
    .filter(Boolean)
    .map(normalizeRepoPath)
    .filter((filePath) => existsSync(path.join(root, filePath)))
}

export function checkDocumentationGovernance(root = REPO_ROOT) {
  const files = listRepositoryFiles(root)
  return verifyDocumentationGovernance({
    files,
    readText: (filePath) => readFileSync(path.join(root, filePath), 'utf8')
  })
}

function main() {
  const errors = checkDocumentationGovernance()
  if (errors.length > 0) {
    console.error('Documentation governance check failed:')
    for (const error of errors) {
      console.error(`  - ${error}`)
    }
    process.exitCode = 1
    return
  }
  console.log(`Documentation governance passed: ${CANONICAL_PRODUCT_DESIGN} is authoritative.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
