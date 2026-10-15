import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  MAX_BUNDLE_BYTES,
  parseBundleInputs,
  inspectBundle,
  downloadBundleBlob,
  verifyCandidateCheckpoint,
  verifyFrozenBundleInputs,
  importCandidateBundle,
  writeCandidateArtifact
} from './upstream-sync-bundle-input.mjs'
import { createGit } from './upstream-sync-checkpoint.mjs'

const sha = (letter) => letter.repeat(40)
const inputs = {
  bundleBlobSha: sha('a'),
  target: sha('b'),
  upstream: sha('c'),
  candidate: sha('d'),
  targetBranch: 'hivecode/main-next',
  repository: 'owner/product'
}
const environment = {
  BUNDLE_BLOB_SHA: inputs.bundleBlobSha,
  EXPECTED_TARGET_SHA: inputs.target,
  EXPECTED_UPSTREAM_SHA: inputs.upstream,
  EXPECTED_CANDIDATE_SHA: inputs.candidate,
  TARGET_BRANCH: inputs.targetBranch,
  GITHUB_REPOSITORY: inputs.repository
}
const blobSha = (bytes) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
const bundle = (
  header = `# v2 git bundle\n-${inputs.target} prerequisite\n${inputs.candidate} refs/heads/${inputs.targetBranch}\n\n`
) => Buffer.from(`${header}PACKfixture`)

describe('short-lived candidate bundle admission', () => {
  it('keeps the scheduled path when all four optional inputs are empty', () => {
    expect(
      parseBundleInputs({ TARGET_BRANCH: 'main', GITHUB_REPOSITORY: 'owner/product' })
    ).toBeNull()
    expect(parseBundleInputs(environment)).toEqual(inputs)
  })
  it.each([
    'BUNDLE_BLOB_SHA',
    'EXPECTED_TARGET_SHA',
    'EXPECTED_UPSTREAM_SHA',
    'EXPECTED_CANDIDATE_SHA'
  ])('rejects partial inputs missing %s', (key) => {
    expect(() => parseBundleInputs({ ...environment, [key]: '' })).toThrow(/all four/)
  })
  it.each([
    { EXPECTED_TARGET_SHA: 'HEAD' },
    { EXPECTED_UPSTREAM_SHA: 'a'.repeat(39) },
    { EXPECTED_CANDIDATE_SHA: 'A'.repeat(40) },
    { BUNDLE_BLOB_SHA: `${'a'.repeat(40)}\n` },
    { TARGET_BRANCH: 'feature/test' },
    { GITHUB_REPOSITORY: '../other' },
    { GITHUB_REPOSITORY: 'owner/repo?x=y' }
  ])('rejects unsafe input before commands: %j', (override) => {
    expect(() => parseBundleInputs({ ...environment, ...override })).toThrow()
  })
  it('accepts only the exact thin bundle ref, prerequisite and content address', () => {
    const bytes = bundle()
    expect(inspectBundle(bytes, { ...inputs, bundleBlobSha: blobSha(bytes) })).toMatchObject({
      candidate: inputs.candidate,
      prerequisite: inputs.target
    })
    expect(() => inspectBundle(bytes, inputs)).toThrow(/blob SHA/)
  })
  it.each([
    `# v2 git bundle\n${inputs.candidate} refs/heads/${inputs.targetBranch}\n\n`,
    `# v2 git bundle\n-${sha('e')} other\n${inputs.candidate} refs/heads/${inputs.targetBranch}\n\n`,
    `# v2 git bundle\n-${inputs.target} base\n-${sha('e')} extra\n${inputs.candidate} refs/heads/${inputs.targetBranch}\n\n`,
    `# v2 git bundle\n-${inputs.target} base\n${inputs.candidate} refs/heads/other\n\n`,
    `# v2 git bundle\n-${inputs.target} base\n${sha('e')} refs/heads/${inputs.targetBranch}\n\n`,
    `# v2 git bundle\n-${inputs.target} base\n${inputs.candidate} refs/heads/${inputs.targetBranch}\n${inputs.candidate} HEAD\n\n`,
    `# v3 git bundle\n@filter=blob:none\n-${inputs.target} base\n${inputs.candidate} refs/heads/${inputs.targetBranch}\n\n`
  ])('rejects unexpected refs, prerequisites, candidates and capabilities', (header) => {
    const bytes = bundle(header)
    expect(() => inspectBundle(bytes, { ...inputs, bundleBlobSha: blobSha(bytes) })).toThrow()
  })
  it('enforces the actual blob size before hashing', () => {
    expect(() => inspectBundle(Buffer.alloc(MAX_BUNDLE_BYTES + 1), inputs)).toThrow(/100 MB/)
  })
  it('uses only same-repository raw Git blob GET with read-only authentication', async () => {
    const bytes = bundle()
    const fetchImpl = vi.fn(async () => new Response(bytes))
    expect(await downloadBundleBlob(inputs, { token: 'test-token', fetchImpl })).toEqual(bytes)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://api.github.com/repos/owner/product/git/blobs/${inputs.bundleBlobSha}`)
    expect(options.method).toBe('GET')
    expect(options.redirect).toBe('error')
    expect(options.headers.Accept).toBe('application/vnd.github.raw+json')
  })
  it('fails explicitly when the unreferenced handoff blob has disappeared', async () => {
    await expect(
      downloadBundleBlob(inputs, { fetchImpl: async () => new Response('', { status: 404 }) })
    ).rejects.toThrow(/unavailable.*404/)
  })
  it('rejects advertised and streamed oversize bodies', async () => {
    await expect(
      downloadBundleBlob(inputs, {
        fetchImpl: async () =>
          new Response('', { headers: { 'content-length': String(MAX_BUNDLE_BYTES + 1) } })
      })
    ).rejects.toThrow(/100 MB/)
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_BUNDLE_BYTES))
        controller.enqueue(new Uint8Array(1))
        controller.close()
      }
    })
    await expect(
      downloadBundleBlob(inputs, { fetchImpl: async () => new Response(body) })
    ).rejects.toThrow(/100 MB/)
  })
})

const report = {
  passed: true,
  blockers: [],
  upstreamSha: inputs.upstream,
  stateRef: inputs.target,
  headSha: inputs.candidate,
  targetBranch: inputs.targetBranch,
  pendingShas: [sha('e')],
  commits: [{}],
  audit: { mode: 'incremental', baseSha: sha('f') }
}
const checkpoint = () => ({
  schemaVersion: 1,
  upstream: 'stablyai/orca',
  targetBranch: inputs.targetBranch,
  initialAuditCompleted: true,
  lastReviewedUpstreamSha: inputs.upstream,
  pendingShas: [sha('e')],
  lastAudit: {
    mode: 'incremental',
    baseSha: sha('f'),
    inclusionHeadSha: sha('1'),
    productSha: inputs.target,
    commitCount: 1,
    generatedAt: '2026-10-15T00:00:00.000Z',
    activation:
      'Effective after boundary review, exact-candidate gates and fast-forward product publication'
  }
})
describe('candidate checkpoint is verified without rewriting its timestamp or SHA', () => {
  it('rejects a deleted checkpoint instead of resetting the reviewed cursor', () => {
    expect(() =>
      verifyCandidateCheckpoint({
        state: null,
        previous: checkpoint(),
        report,
        contentCommitSha: sha('1')
      })
    ).toThrow(/checkpoint/)
  })
  it('accepts a closed exact checkpoint without mutating it', () => {
    const state = checkpoint(),
      before = JSON.stringify(state)
    verifyCandidateCheckpoint({ state, previous: null, report, contentCommitSha: sha('1') })
    expect(JSON.stringify(state)).toBe(before)
  })
  it.each([
    { pendingShas: [] },
    { lastReviewedUpstreamSha: sha('a') },
    { initialAuditCompleted: false },
    { lastAudit: { ...checkpoint().lastAudit, productSha: sha('a') } },
    { lastAudit: { ...checkpoint().lastAudit, inclusionHeadSha: inputs.candidate } },
    { lastAudit: { ...checkpoint().lastAudit, commitCount: 0 } }
  ])('rejects dropped pending decisions or mismatched checkpoint identity: %j', (patch) => {
    expect(() =>
      verifyCandidateCheckpoint({
        state: { ...checkpoint(), ...patch },
        previous: null,
        report,
        contentCommitSha: sha('1')
      })
    ).toThrow(/checkpoint/)
  })
})

describe('workflow bundle transport contract', () => {
  const workflow = parse(
    readFileSync(new URL('../../.github/workflows/upstream-sync.yml', import.meta.url), 'utf8')
  )
  it('keeps schedule, permission separation and all real platform gates', () => {
    expect(workflow.on.schedule).toEqual([{ cron: '17 2 * * *' }])
    expect(Object.keys(workflow.on.workflow_dispatch.inputs).sort()).toEqual([
      'bundle_blob_sha',
      'candidate_sha',
      'target_branch',
      'target_sha',
      'upstream_sha'
    ])
    for (const name of ['sync', 'gates', 'platform-gates']) {
      expect(workflow.jobs[name].permissions).toEqual({ contents: 'read' })
    }
    expect(workflow.jobs.publish.permissions).toEqual({ contents: 'write' })
    expect(
      workflow.jobs['platform-gates'].strategy.matrix.include.map((x) => x.platform).sort()
    ).toEqual(['darwin', 'linux', 'win32'])
    const steps = workflow.jobs.sync.steps
    const incoming = steps.find((s) => s.id === 'bundle_input')
    expect(incoming.run).toContain(
      '$RUNNER_TEMP/upstream-sync-control/config/scripts/upstream-sync-bundle-input.mjs'
    )
    expect(incoming.run).not.toContain('--write-checkpoint')
    expect(incoming.env.GITHUB_REPOSITORY).toBe('${{ github.repository }}')
    for (const step of steps.filter(
      (s) =>
        s.run?.includes('--write-checkpoint') || s.run?.includes('upstream-tree-sync.mjs" prepare')
    )) {
      expect(step.if).toContain("inputs.bundle_blob_sha == ''")
    }
    expect(
      steps.some(
        (s) => s.uses === 'actions/upload-artifact@v7' && s.with.name === 'upstream-sync-candidate'
      )
    ).toBe(true)
    expect(
      workflow.jobs.publish.steps.some((s) => s.run?.includes('checkout --detach "$CANDIDATE_SHA"'))
    ).toBe(false)
  })
})

describe('real thin bundle object import', () => {
  it('imports the declared candidate exactly without changing HEAD, checkout or checkpoint bytes', () => {
    const root = resolve('logs/upstream-sync/bundle-input-tests')
    mkdirSync(root, { recursive: true })
    const fixture = mkdtempSync(join(root, 'exact-'))
    const source = join(fixture, 'source'),
      receiver = join(fixture, 'receiver')
    mkdirSync(source)
    mkdirSync(receiver)
    const sourceGit = createGit(source),
      receiverRaw = createGit(receiver)
    const receiverGit = (args) =>
      receiverRaw(['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', ...args])
    sourceGit(['init', '-b', 'main'])
    sourceGit(['config', 'core.autocrlf', 'false'])
    sourceGit(['config', 'user.name', 'Bundle fixture'])
    sourceGit(['config', 'user.email', 'bundle-fixture@localhost'])
    sourceGit(['config', 'commit.gpgSign', 'false'])
    writeFileSync(join(source, 'state.txt'), 'frozen target\n')
    sourceGit(['add', 'state.txt'])
    sourceGit(['commit', '-m', 'target'])
    const target = sourceGit(['rev-parse', 'HEAD']).trim()
    writeFileSync(join(source, 'state.txt'), 'exact candidate timestamp remains unchanged\n')
    sourceGit(['add', 'state.txt'])
    sourceGit(['commit', '-m', 'candidate'])
    const candidate = sourceGit(['rev-parse', 'HEAD']).trim()
    const file = join(fixture, 'candidate.bundle')
    sourceGit(['bundle', 'create', file, 'refs/heads/main', `^${target}`])
    receiverGit(['init', '-b', 'main'])
    receiverGit(['config', 'core.autocrlf', 'false'])
    receiverGit(['fetch', '--no-tags', source, target])
    receiverGit(['checkout', '--detach', target])
    const input = {
      ...inputs,
      targetBranch: 'main',
      target,
      candidate,
      bundleBlobSha: blobSha(readFileSync(file))
    }
    expect(importCandidateBundle(input, file, receiverGit)).toBe(candidate)
    expect(receiverGit(['rev-parse', 'HEAD']).trim()).toBe(target)
    expect(readFileSync(join(receiver, 'state.txt'), 'utf8')).toBe('frozen target\n')
    expect(receiverGit(['show', `${candidate}:state.txt`])).toBe(
      'exact candidate timestamp remains unchanged\n'
    )
    expect(receiverGit(['status', '--porcelain']).trim()).toBe('')
    receiverGit(['update-ref', 'refs/heads/main', target])
    const artifact = join(fixture, 'artifact.bundle')
    writeCandidateArtifact(input, artifact, receiverGit)
    expect(receiverGit(['bundle', 'list-heads', artifact]).trim()).toBe(
      `${candidate} refs/heads/main`
    )
    expect(receiverGit(['rev-parse', 'refs/heads/main']).trim()).toBe(target)
    expect(receiverGit(['rev-parse', 'HEAD']).trim()).toBe(target)
    // The official artifact is self-contained, unlike the short-lived input handoff.
    expect(readFileSync(artifact).subarray(0, 200).toString()).not.toContain(`-${target}`)
    expect(() =>
      importCandidateBundle({ ...input, candidate: sha('e') }, file, receiverGit)
    ).toThrow(/candidate or ref/)
  }, 30_000)
  it('requires fetched upstream reachability and the current same-repository product tip', () => {
    const commands = []
    const git = (args) => {
      commands.push(args)
      if (args[0] === 'remote') {
        return 'https://github.com/owner/product.git\n'
      }
      if (args[0] === 'rev-parse') {
        return args.at(-1).replace(/\^\{commit\}$/, '')
      }
      if (args[0] === 'ls-remote') {
        return `${inputs.target}\trefs/heads/${inputs.targetBranch}\n`
      }
      return ''
    }
    verifyFrozenBundleInputs(inputs, git)
    expect(commands).toContainEqual([
      'merge-base',
      '--is-ancestor',
      inputs.upstream,
      'refs/remotes/upstream/main'
    ])
    expect(() =>
      verifyFrozenBundleInputs(inputs, (args) =>
        args[0] === 'ls-remote' ? `${sha('f')}\trefs/heads/${inputs.targetBranch}\n` : git(args)
      )
    ).toThrow(/main moved/)
    expect(() =>
      verifyFrozenBundleInputs(inputs, (args) => {
        if (args[0] === 'merge-base') {
          throw new Error('unreachable upstream')
        }
        return git(args)
      })
    ).toThrow('unreachable upstream')
    expect(() =>
      verifyFrozenBundleInputs(inputs, (args) =>
        args[0] === 'remote' ? 'https://github.com/third-party/repo.git' : git(args)
      )
    ).toThrow(/not this GitHub repository/)
  })
})
