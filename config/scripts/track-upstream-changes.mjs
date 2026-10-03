import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { collectCommitHistory } from './upstream-intake-history.mjs'
import { createGit, resolveAuditRange } from './upstream-sync-checkpoint.mjs'

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const PRIORITY_PATH = path.join(REPO_ROOT, 'config', 'upstream-change-priority.json')
const DEFAULT_BASE = 'upstream/main'
const DEFAULT_HEAD = 'HEAD'

const runGit = createGit()

export function loadPriorityManifest(manifestPath = PRIORITY_PATH) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    !Number.isInteger(manifest.defaultPriority) ||
    !Array.isArray(manifest.priorities) ||
    manifest.priorities.length === 0
  ) {
    throw new Error('upstream-change-priority.json must use schemaVersion 1 and define priorities')
  }
  const levels = manifest.priorities.map((priority) => priority.level)
  if (
    new Set(levels).size !== levels.length ||
    levels.some((level) => !Number.isInteger(level) || level < 1) ||
    !levels.includes(manifest.defaultPriority)
  ) {
    throw new Error(
      'Upstream change priorities must have unique positive levels including the default'
    )
  }
  const ids = manifest.priorities.map((priority) => priority.id)
  if (
    ids.some((id) => typeof id !== 'string' || id.length === 0) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error('Upstream change priorities must have unique non-empty ids')
  }
  for (const priority of manifest.priorities) {
    compilePatterns(priority.pathPatterns, 'pathPatterns', priority.id)
    compilePatterns(priority.subjectPatterns, 'subjectPatterns', priority.id)
  }
  return manifest
}

function compilePatterns(patterns, field, priorityId) {
  if (!Array.isArray(patterns)) {
    throw new Error(`${priorityId}.${field} must be an array`)
  }
  return patterns.map((pattern) => {
    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new Error(`${priorityId}.${field} entries must be non-empty strings`)
    }
    return new RegExp(pattern, 'i')
  })
}

function normalizedPaths(paths) {
  return paths.map((filePath) => filePath.replaceAll('\\', '/'))
}

export function classifyUpstreamChange({ subject, paths, manifest = loadPriorityManifest() }) {
  const normalizedSubject = String(subject ?? '')
  const normalized = normalizedPaths(paths ?? [])
  const matches = []

  for (const priority of manifest.priorities) {
    const pathPatterns = compilePatterns(priority.pathPatterns, 'pathPatterns', priority.id)
    const subjectPatterns = compilePatterns(
      priority.subjectPatterns,
      'subjectPatterns',
      priority.id
    )
    const pathMatches = normalized.filter((filePath) =>
      pathPatterns.some((pattern) => pattern.test(filePath))
    )
    const subjectMatches = subjectPatterns.some((pattern) => pattern.test(normalizedSubject))
    if (pathMatches.length > 0 || subjectMatches) {
      matches.push({
        level: priority.level,
        id: priority.id,
        label: priority.label,
        action: priority.action,
        reasons: [
          ...pathMatches.map((filePath) => `path:${filePath}`),
          ...(subjectMatches ? [`subject:${normalizedSubject}`] : [])
        ]
      })
    }
  }

  const selected =
    matches.sort((left, right) => left.level - right.level)[0] ??
    (() => {
      const fallback = manifest.priorities.find(
        (priority) => priority.level === manifest.defaultPriority
      )
      return {
        level: manifest.defaultPriority,
        id: fallback?.id ?? 'manual-review',
        label: fallback?.label ?? 'Manual review',
        action: fallback?.action ?? 'Require explicit review before absorption.',
        reasons: ['default: no priority rule matched']
      }
    })()

  return {
    priority: selected.level,
    priorityId: selected.id,
    label: selected.label,
    action: selected.action,
    reasons: [...new Set(selected.reasons)],
    matchedRuleCount: matches.length,
    reviewRequired: selected.level === manifest.defaultPriority
  }
}

function parseCommitLog(output) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('\t')
      if (separator <= 0) {
        throw new Error(`Unexpected upstream commit entry: ${line}`)
      }
      return { sha: line.slice(0, separator), subject: line.slice(separator + 1) }
    })
}

function collectCommitPaths(git, sha) {
  return git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-M', sha])
    .split(/\r?\n/)
    .filter(Boolean)
}

export function collectUpstreamChanges({
  base = DEFAULT_BASE,
  head = DEFAULT_HEAD,
  git = runGit,
  manifest = loadPriorityManifest(),
  stateRef,
  targetBranch = 'hivecode/main-next'
}) {
  const range = stateRef ? resolveAuditRange({ git, upstream: head, stateRef, targetBranch }) : null
  const resolvedBase = range
    ? range.audit.baseSha
    : git(['rev-parse', '--verify', '--end-of-options', base]).trim()
  const resolvedHead = range
    ? range.upstreamSha
    : git(['rev-parse', '--verify', '--end-of-options', head]).trim()
  const commits = range
    ? collectCommitHistory(git, range.selectedShas)
    : parseCommitLog(
        git(['log', '--no-merges', '--format=%H%x09%s', `${resolvedBase}..${resolvedHead}`])
      )
  const changes = commits.map((commit) => {
    const paths = normalizedPaths(commit.paths ?? collectCommitPaths(git, commit.sha))
    return { ...commit, paths, ...classifyUpstreamChange({ ...commit, paths, manifest }) }
  })
  const counts = Object.fromEntries(
    manifest.priorities.map((priority) => [
      priority.level,
      changes.filter((change) => change.priority === priority.level).length
    ])
  )
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    base: range ? (resolvedBase ?? 'complete reachable history') : base,
    head,
    baseSha: resolvedBase,
    headSha: resolvedHead,
    ...(range
      ? { audit: range.audit, stateRef: range.stateRef, pendingShas: range.pendingShas }
      : {}),
    counts,
    changes
  }
}

function renderItems(items) {
  return items.length === 0 ? '- none' : items.map((item) => item).join('\n')
}

export function renderMarkdown(report, manifest = loadPriorityManifest()) {
  const sections = manifest.priorities
    .slice()
    .sort((left, right) => left.level - right.level)
    .map((priority) => {
      const changes = report.changes.filter((change) => change.priority === priority.level)
      return `## Priority ${priority.level}: ${priority.label} (${changes.length})\n\n${renderItems(
        changes.map(
          (change) =>
            `- \`${change.sha.slice(0, 12)}\` ${change.subject} — ${change.action}${change.reviewRequired ? ' **manual review**' : ''}\n  - Reason: ${change.reasons.join(', ')}\n  - Paths: ${change.paths.length > 0 ? change.paths.join(', ') : 'none'}`
        )
      )}`
    })
    .join('\n\n')

  return `# Upstream Change Intake\n\n- Generated at: \`${report.generatedAt}\`\n- Base: \`${report.base}\` (${report.baseSha})\n- Head: \`${report.head}\` (${report.headSha})\n- Commits tracked: \`${report.changes.length}\`\n\n${sections}\n`
}

export function parseArgs(argv) {
  const options = { base: DEFAULT_BASE, head: DEFAULT_HEAD, format: 'markdown', output: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') {
      options.format = 'json'
    } else if (
      ['--base', '--head', '--output', '--state-ref', '--target-branch', '--cwd'].includes(argument)
    ) {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${argument} requires a value`)
      }
      const key =
        { '--state-ref': 'stateRef', '--target-branch': 'targetBranch' }[argument] ??
        argument.slice(2)
      options[key] = value
      index += 1
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (options.stateRef && argv.includes('--base')) {
    throw new Error('--base cannot override the product checkpoint')
  }
  return options
}

function usage() {
  return `Usage: node config/scripts/track-upstream-changes.mjs [options]\n\nOptions:\n  --state-ref <sha>  Frozen product commit owning the reviewed cursor\n  --target-branch <branch> Product identity (default: hivecode/main-next)\n  --base <ref>       Legacy explicit range; cannot accompany --state-ref\n  --head <ref>       Frozen upstream commit (default: HEAD)\n  --cwd <path>       Git checkout (default: current directory)\n  --json             Emit JSON instead of Markdown\n  --output <path>    Also write the report to a file\n  --help             Show this help\n`
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage())
    } else {
      const manifest = loadPriorityManifest()
      const report = collectUpstreamChanges({ ...options, manifest, git: createGit(options.cwd) })
      const output =
        options.format === 'json'
          ? `${JSON.stringify(report, null, 2)}\n`
          : renderMarkdown(report, manifest)
      if (options.output) {
        writeFileSync(path.resolve(options.output), output, 'utf8')
      }
      process.stdout.write(output)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
