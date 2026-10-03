import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_BASE = 'upstream/main'
const DEFAULT_HEAD = 'HEAD'
const SYNC_BOUNDARY = JSON.parse(
  readFileSync(new URL('../upstream-sync-boundary.json', import.meta.url), 'utf8')
)

const UPSTREAM_CORE_PREFIXES = [
  'src/main/runtime/',
  'src/shared/',
  'src/relay/',
  'src/main/orca-profiles/',
  'mobile/src/transport/'
]

const PRODUCT_OVERLAY_PREFIXES = [
  'config/product/',
  'src/main/product/',
  'src/shared/generated/product-config.ts',
  'mobile/src/generated/product-config.ts'
]

const ENDPOINT_PATTERN =
  'onorca\\.dev|stablyai/orca|orca-desktop|login\\.onorca\\.dev|relay\\.onorca\\.dev'

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
}

function cleanOutput(value) {
  return value.trim()
}

function gitOrEmpty(git, args) {
  try {
    return git(args)
  } catch (error) {
    // git grep exits with status 1 when there are no matches. That is a valid audit result.
    if (error?.status === 1) {
      return ''
    }
    throw error
  }
}

export function parseNameStatus(output) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t')
      const match = /^(A|M|D|R|C|T)(\d{1,3})?$/.exec(fields[0])
      if (!match) {
        throw new Error(`Unexpected git name-status entry: ${line}`)
      }
      const status = match[1]
      const score = match[2] === undefined ? null : Number(match[2])
      if ((status === 'R' || status === 'C') && fields.length < 3) {
        throw new Error(`Rename/copy entry is missing a path: ${line}`)
      }
      if (status !== 'R' && status !== 'C' && fields.length < 2) {
        throw new Error(`Git name-status entry is missing a path: ${line}`)
      }
      return {
        status,
        score,
        path: fields[status === 'R' || status === 'C' ? 2 : 1],
        oldPath: status === 'R' || status === 'C' ? fields[1] : null
      }
    })
}

export function parseRevListCount(output) {
  const fields = output.trim().split(/\s+/)
  if (fields.length !== 2 || fields.some((field) => !/^\d+$/.test(field))) {
    throw new Error(`Unexpected git rev-list count: ${output.trim()}`)
  }
  return { behind: Number(fields[0]), ahead: Number(fields[1]) }
}

export function classifyForkPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/')
  const classes = []

  if (UPSTREAM_CORE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    classes.push('upstreamCore')
  }
  if (PRODUCT_OVERLAY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    classes.push('productOverlay')
  }
  if (
    normalized.includes('/runtime/rpc/') ||
    normalized.startsWith('src/relay/') ||
    /(?:^|\/)(?:rpc|schema|protocol)(?:\/|[-_.])/i.test(normalized)
  ) {
    classes.push('rpcSchema')
  }
  if (
    normalized.startsWith('src/main/persistence/') ||
    /(?:^|\/)(?:migrations?|schema)(?:\/|[-_.])/i.test(normalized)
  ) {
    classes.push('persistence')
  }
  if (/(?:^|\/)(?:blueprint|pet)(?:\/|[-_.])/i.test(normalized)) {
    classes.push('blueprintPet')
  }

  return classes
}

function matchesBoundaryPrefix(filePath, prefix) {
  const normalized = filePath.replaceAll('\\', '/')
  return normalized === prefix || normalized.startsWith(prefix)
}

export function classifySyncBoundaryPath(filePath) {
  if (
    SYNC_BOUNDARY.productBoundary.paths.some((prefix) => matchesBoundaryPrefix(filePath, prefix))
  ) {
    return 'productBoundary'
  }
  if (SYNC_BOUNDARY.manualReview.paths.some((prefix) => matchesBoundaryPrefix(filePath, prefix))) {
    return 'manualReview'
  }
  if (
    SYNC_BOUNDARY.moduleSplitTargets?.some((target) =>
      target.boundaryPaths?.some((prefix) => matchesBoundaryPrefix(filePath, prefix))
    )
  ) {
    return 'manualReview'
  }
  if (SYNC_BOUNDARY.directAbsorb.paths.some((prefix) => matchesBoundaryPrefix(filePath, prefix))) {
    return 'directAbsorb'
  }
  return null
}

function parseOwnCommits(output) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('\t')
      if (separator <= 0) {
        throw new Error(`Unexpected git commit entry: ${line}`)
      }
      return { sha: line.slice(0, separator), subject: line.slice(separator + 1) }
    })
}

function normalizeGrepPath(line, head) {
  const prefix = `${head}:`
  return line.startsWith(prefix) ? line.slice(prefix.length) : line
}

export function sanitizeEndpointMatch(line, head) {
  const normalized = normalizeGrepPath(line, head)
  const parsed = /^(.*):(\d+):(.*)$/.exec(normalized)
  if (!parsed) {
    return '[unparsed endpoint match redacted]'
  }
  const evidence = uniqueSorted(parsed[3].match(new RegExp(ENDPOINT_PATTERN, 'gi')) ?? [])
  return `${parsed[1]}:${parsed[2]}:${evidence.join(', ') || '[endpoint match redacted]'}`
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function pathsForClass(changes, className) {
  return uniqueSorted(
    changes
      .flatMap((change) => [change.path, change.oldPath].filter(Boolean))
      .filter((filePath) => {
        return classifyForkPath(filePath).includes(className)
      })
  )
}

function statusCounts(changes) {
  const counts = { added: 0, modified: 0, deleted: 0, renamed: 0, copied: 0, typeChanged: 0 }
  for (const change of changes) {
    if (change.status === 'A') {
      counts.added += 1
    } else if (change.status === 'M') {
      counts.modified += 1
    } else if (change.status === 'D') {
      counts.deleted += 1
    } else if (change.status === 'R') {
      counts.renamed += 1
    } else if (change.status === 'C') {
      counts.copied += 1
    } else if (change.status === 'T') {
      counts.typeChanged += 1
    }
  }
  return counts
}

export function collectForkDelta({
  base = DEFAULT_BASE,
  head = DEFAULT_HEAD,
  comparison = 'ancestry',
  git = runGit
}) {
  if (!['ancestry', 'trees'].includes(comparison)) {
    throw new Error(`Unsupported comparison mode: ${comparison}`)
  }
  const resolvedBase = cleanOutput(git(['rev-parse', '--verify', '--end-of-options', base]))
  const resolvedHead = cleanOutput(git(['rev-parse', '--verify', '--end-of-options', head]))
  const mergeBase =
    comparison === 'trees' ? null : cleanOutput(git(['merge-base', resolvedBase, resolvedHead]))
  const baseSha = resolvedBase
  const headSha = resolvedHead
  const ancestry =
    comparison === 'trees'
      ? { behind: null, ahead: null }
      : parseRevListCount(
          git(['rev-list', '--left-right', '--count', `${resolvedBase}...${resolvedHead}`])
        )
  const ownCommits =
    comparison === 'trees'
      ? null
      : parseOwnCommits(
          git(['log', '--no-merges', '--format=%H%x09%s', `${resolvedBase}..${resolvedHead}`])
        )
  const changedFiles = parseNameStatus(
    git(
      comparison === 'trees'
        ? ['diff', '--name-status', '--no-ext-diff', '-M', resolvedBase, resolvedHead, '--']
        : ['diff', '--name-status', '--no-ext-diff', '-M', `${resolvedBase}...${resolvedHead}`]
    )
  )
  const counts = { ...ancestry, ...statusCounts(changedFiles) }

  const hivecodeLiteralFiles = uniqueSorted(
    gitOrEmpty(git, [
      'grep',
      '--files-with-matches',
      '--ignore-case',
      '-e',
      'hivecode',
      resolvedHead,
      '--'
    ])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => normalizeGrepPath(line, resolvedHead))
  )

  const upstreamEndpointMatches = gitOrEmpty(git, [
    'grep',
    '--line-number',
    '--ignore-case',
    '--extended-regexp',
    '-e',
    ENDPOINT_PATTERN,
    resolvedHead,
    '--'
  ])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => sanitizeEndpointMatch(line, resolvedHead))

  const boundaryFiles = (className) =>
    uniqueSorted(
      changedFiles
        .flatMap((change) => [change.path, change.oldPath].filter(Boolean))
        .filter((filePath) => classifySyncBoundaryPath(filePath) === className)
    )

  return {
    schemaVersion: 1,
    comparison,
    generatedAt: new Date().toISOString(),
    base,
    head,
    mergeBase,
    baseSha,
    headSha,
    counts,
    ownCommits,
    changedFiles,
    upstreamCoreFiles: pathsForClass(changedFiles, 'upstreamCore'),
    productOverlayFiles: pathsForClass(changedFiles, 'productOverlay'),
    hivecodeLiteralFiles,
    upstreamEndpointMatches,
    rpcSchemaFiles: pathsForClass(changedFiles, 'rpcSchema'),
    persistenceFiles: pathsForClass(changedFiles, 'persistence'),
    blueprintPetFiles: pathsForClass(changedFiles, 'blueprintPet'),
    productBoundaryFiles: boundaryFiles('productBoundary'),
    directAbsorbFiles: boundaryFiles('directAbsorb'),
    manualReviewFiles: boundaryFiles('manualReview')
  }
}

function renderItems(items) {
  return items.length === 0 ? '- none' : items.map((item) => `- ${item}`).join('\n')
}

function renderChangedFiles(changedFiles) {
  if (changedFiles.length === 0) {
    return '- none'
  }
  return changedFiles
    .map((change) => {
      const pathText = change.oldPath ? `${change.oldPath} -> ${change.path}` : change.path
      const score = change.score === null ? '' : String(change.score)
      return `- ${change.status}${score}\t${pathText}`
    })
    .join('\n')
}

export function renderMarkdown(report) {
  const { counts } = report
  return `# HiveCode Fork Delta Audit

- Generated at: \`${report.generatedAt}\`
- Base: \`${report.base}\` (${report.baseSha})
- Head: \`${report.head}\` (${report.headSha})
- Comparison: \`${report.comparison ?? 'ancestry'}\`
- Merge base: \`${report.mergeBase ?? 'N/A'}\`
- Behind / ahead: \`${counts.behind ?? 'N/A'} / ${counts.ahead ?? 'N/A'}\`
- File status A/M/D/R/C/T: \`${counts.added}/${counts.modified}/${counts.deleted}/${counts.renamed}/${counts.copied}/${counts.typeChanged}\`

## Non-merge commits unique to head (${report.ownCommits?.length ?? 'N/A'})

${report.ownCommits === null ? '- Not applicable to a tree comparison' : renderItems(report.ownCommits.map((commit) => `${commit.sha} ${commit.subject}`))}

## Changed files (${report.changedFiles.length})

${renderChangedFiles(report.changedFiles)}

## Upstream-core files (${report.upstreamCoreFiles.length})

${renderItems(report.upstreamCoreFiles)}

## Product overlay files (${report.productOverlayFiles.length})

${renderItems(report.productOverlayFiles)}

## Synchronization boundary: product-owned (${report.productBoundaryFiles?.length ?? 0})

${renderItems(report.productBoundaryFiles ?? [])}

## Synchronization boundary: directly absorbable (${report.directAbsorbFiles?.length ?? 0})

${renderItems(report.directAbsorbFiles ?? [])}

## Synchronization boundary: manual review (${report.manualReviewFiles?.length ?? 0})

${renderItems(report.manualReviewFiles ?? [])}

## HiveCode literal files (${report.hivecodeLiteralFiles.length})

${renderItems(report.hivecodeLiteralFiles)}

## Upstream endpoint matches (${report.upstreamEndpointMatches.length})

${renderItems(report.upstreamEndpointMatches)}

## RPC/schema files (${report.rpcSchemaFiles.length})

${renderItems(report.rpcSchemaFiles)}

## Persistence files (${report.persistenceFiles.length})

${renderItems(report.persistenceFiles)}

## Blueprint/Pet files (${report.blueprintPetFiles.length})

${renderItems(report.blueprintPetFiles)}
`
}

export function parseArgs(argv) {
  const options = { base: DEFAULT_BASE, head: DEFAULT_HEAD, format: 'markdown', output: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') {
      options.format = 'json'
    } else if (['--base', '--head', '--output', '--comparison'].includes(argument)) {
      const value = argv[index + 1]
      if (!value) {
        throw new Error(`${argument} requires a value`)
      }
      if (argument === '--comparison' && !['ancestry', 'trees'].includes(value)) {
        throw new Error(`Unsupported comparison mode: ${value}`)
      }
      options[argument.slice(2)] = value
      index += 1
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  return options
}

function usage() {
  return `Usage: node config/scripts/audit-fork-delta.mjs [options]

Options:
  --base <ref>       Comparison base (default: upstream/main)
  --head <ref>       Comparison head (default: HEAD)
  --comparison <mode> ancestry (default) or explicit trees without ancestry claims
  --json             Emit JSON instead of Markdown
  --output <path>    Also write the report to a file
  --help             Show this help
`
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  const report = collectForkDelta(options)
  const output =
    options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report)
  if (options.output) {
    writeFileSync(path.resolve(options.output), output, 'utf8')
  }
  process.stdout.write(output)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
