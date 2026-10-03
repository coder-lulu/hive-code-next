import { spawn } from 'node:child_process'
import { SHA_PATTERN } from './upstream-sync-checkpoint.mjs'

export function collectCommitHistory(git, shas) {
  if (!shas.length) {
    return []
  }
  const output = git(
    [
      'log',
      '--no-walk=unsorted',
      '--stdin',
      '--root',
      '-m',
      '--no-renames',
      '--format=%x1e%H%x00%P%x00%s%x00',
      '--name-only',
      '-z'
    ],
    `${shas.join('\n')}\n`
  )
  const commits = new Map()
  for (const record of output.split('\x1e').filter(Boolean)) {
    const [sha, parents, subject, ...names] = record.split('\0')
    if (!SHA_PATTERN.test(sha)) {
      throw new Error('Malformed upstream history record')
    }
    const paths = names.filter(Boolean).map((name) => name.replace(/^\n/, ''))
    const previous = commits.get(sha)
    commits.set(sha, {
      sha,
      parents: parents.split(' ').filter(Boolean),
      subject,
      paths: [...new Set([...(previous?.paths ?? []), ...paths])]
    })
  }
  if (shas.some((sha) => !commits.has(sha))) {
    throw new Error('Incomplete upstream history enumeration')
  }
  return [...commits.values()]
}

// Stream patches between two Git processes: full-history audits must not buffer every diff.
export async function collectPatchIds(cwd, shas) {
  if (!shas.length) {
    return new Map()
  }
  const options = { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  const patches = spawn(
    'git',
    [
      'log',
      '--no-walk=unsorted',
      '--stdin',
      '--no-merges',
      '--root',
      '-p',
      '--format=commit %H',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--binary'
    ],
    options
  )
  const ids = spawn('git', ['patch-id', '--stable'], options)
  let output = ''
  let errors = ''
  ids.stdout.setEncoding('utf8').on('data', (chunk) => {
    output += chunk
  })
  for (const child of [patches, ids]) {
    child.stderr.on('data', (chunk) => {
      errors += chunk
    })
  }
  const completed = (child) =>
    new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`git patch audit failed: ${errors}`))
      )
      child.stdin.on('error', reject)
    })
  const completion = Promise.all([completed(patches), completed(ids)])
  patches.stdout.pipe(ids.stdin)
  patches.stdin.end(`${shas.join('\n')}\n`)
  try {
    await completion
  } finally {
    patches.kill()
    ids.kill()
  }
  const result = new Map()
  for (const line of output.trim().split(/\r?\n/).filter(Boolean)) {
    const [patchId, sha] = line.split(/\s+/)
    if (!SHA_PATTERN.test(patchId) || !SHA_PATTERN.test(sha)) {
      throw new Error('Invalid stable patch-id output')
    }
    result.set(sha, patchId)
  }
  return result
}
