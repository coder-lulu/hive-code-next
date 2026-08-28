import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const LEDGER = path.join(ROOT, 'config', 'upstream-change-ledger.json')

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim()
}
function hasCommit(sha, head) {
  try {
    git(['merge-base', '--is-ancestor', sha, head])
    return true
  } catch {
    return false
  }
}
function patchId(sha) {
  try {
    const patch = execFileSync('git', ['show', '--format=', sha], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true
    })
    return (
      execFileSync('git', ['patch-id', '--stable'], {
        cwd: ROOT,
        input: patch,
        encoding: 'utf8',
        windowsHide: true
      })
        .trim()
        .split(/\s+/)[0] || null
    )
  } catch {
    return null
  }
}
function parseArgs(argv) {
  const out = {
    upstream: 'upstream/main',
    vendor: 'vendor-integration',
    head: 'HEAD',
    report: 'docs/upstream-intake-report.md'
  }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--upstream') {
      out.upstream = argv[++i]
    } else if (key === '--vendor') {
      out.vendor = argv[++i]
    } else if (key === '--head') {
      out.head = argv[++i]
    } else if (key === '--report') {
      out.report = argv[++i]
    } else {
      throw new Error(`Unknown argument: ${key}`)
    }
  }
  return out
}
function classify(subject) {
  if (/security|capabilit|trust|permission/i.test(subject)) {
    return '安全'
  }
  if (/fix|bug|crash|restore|prevent|deny|guard/i.test(subject)) {
    return 'BUG'
  }
  if (/refactor|split|contract|transport/i.test(subject)) {
    return '重构'
  }
  if (/ui|i18n|style|theme|layout|tab/i.test(subject)) {
    return 'UI'
  }
  return /feat|add|allow|support|enable|display/i.test(subject) ? '新功能' : 'BUG'
}
function main() {
  const options = parseArgs(process.argv.slice(2))
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'))
  const known = new Map(ledger.entries.map((entry) => [entry.upstreamSha, entry]))
  const headSubjects = new Map()
  for (const line of git(['log', '--format=%H%x09%s', options.head])
    .split(/\r?\n/)
    .filter(Boolean)) {
    const [sha, ...subjectParts] = line.split('\t')
    const subject = subjectParts.join('\t')
    if (!headSubjects.has(subject)) {
      headSubjects.set(subject, sha)
    }
  }
  const shas = git(['log', '--format=%H', `${options.vendor}..${options.upstream}`])
    .split(/\r?\n/)
    .filter(Boolean)
  const rows = shas.map((sha) => {
    const subject = git(['show', '-s', '--format=%s', sha])
    const parents = git(['rev-list', '--parents', '-n', '1', sha]).split(/\s+/).slice(1)
    const entry = known.get(sha)
    const upstreamPatchId = patchId(sha)
    const matchingProductSha = headSubjects.get(subject)
    const equivalentByPatch =
      matchingProductSha !== undefined && patchId(matchingProductSha) === upstreamPatchId
    // Parent closure is a safety gate, not proof that a change is present. A commit is
    // equivalent only when the ledger records a reviewed equivalence (with patch-id).
    const equivalent = entry?.applied === '已等价实现' || equivalentByPatch
    return {
      sha,
      subject,
      type: entry?.type ?? classify(subject),
      applied: entry?.applied ?? (equivalent ? '已等价实现' : '需要产品决定'),
      patchId: upstreamPatchId,
      dependencies: parents.filter((parent) => !hasCommit(parent, options.head))
    }
  })
  const groups = new Map([
    ['已移植', []],
    ['已等价实现', []],
    ['暂缓', []],
    ['需要产品决定', []]
  ])
  for (const row of rows) {
    groups.get(row.applied)?.push(row)
  }
  const lines = [
    `# Upstream intake report`,
    ``,
    `- Upstream: ${git(['rev-parse', options.upstream])}`,
    `- Vendor: ${git(['rev-parse', options.vendor])}`,
    `- Product head: ${git(['rev-parse', options.head])}`,
    ``
  ]
  for (const [title, items] of groups) {
    lines.push(`## ${title}`, ``)
    if (!items.length) {
      lines.push('（无）', '')
    }
    for (const item of items) {
      lines.push(
        `- \`${item.sha.slice(0, 12)}\` [${item.type}] ${item.subject} — patch-id: ${item.patchId ?? '不可用'}${item.dependencies.length ? `；未闭合依赖: ${item.dependencies.join(', ')}` : ''}`
      )
    }
    lines.push('')
  }
  writeFileSync(path.join(ROOT, options.report), `${lines.join('\n')}\n`)
  process.stdout.write(`${lines.join('\n')}\n`)
}
main()
