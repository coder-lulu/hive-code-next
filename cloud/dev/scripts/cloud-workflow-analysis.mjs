export const LEASE_ACTION = './.github/actions/cloud-sql-rollout-lease'

function blockAfter(lines, index) {
  const base = lines[index].length - lines[index].trimStart().length
  const body = []
  for (let i = index + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') { body.push(lines[i]); continue }
    if (lines[i].length - lines[i].trimStart().length <= base) break
    body.push(lines[i])
  }
  return body
}

export function concurrencyBlocks(text) {
  const lines = text.split('\n')
  return lines.flatMap((line, index) => {
    if (line.trim() !== 'concurrency:') return []
    const body = blockAfter(lines, index)
    return [{
      group: body.find((l) => l.trim().startsWith('group:'))?.trim().slice(6).trim(),
      cancelInProgress: body.find((l) => l.trim().startsWith('cancel-in-progress:'))?.trim().slice(18).trim()
    }]
  })
}

export function jobs(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line === 'jobs:')
  if (start === -1) return []
  const found = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i])
    if (match) found.push({ id: match[1], start: i, body: blockAfter(lines, i) })
  }
  return found.map((job) => ({ ...job, text: job.body.join('\n') }))
}

export function leaseSteps(text) {
  const lines = text.split('\n')
  return lines.flatMap((line, index) => {
    if (line.trim() !== `- uses: ${LEASE_ACTION}`) return []
    const body = blockAfter(lines, index)
    const read = (key) => body.find((l) => l.trim().startsWith(`${key}:`))?.trim().slice(key.length + 1).trim()
    return [{ line: index + 1, bucket: read('bucket'), object: read('object'), release: read('release') }]
  })
}

export function jobIf(text, key = 'if') {
  const line = text.split('\n').find((entry) => entry.trim().startsWith(`${key}:`))
  return line?.trim().slice(key.length + 1).trim() ?? ''
}
