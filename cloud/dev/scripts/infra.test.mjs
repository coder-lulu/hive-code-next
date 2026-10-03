import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const script = 'dev/scripts/infra.mjs'

// IAC_TOOL=echo prints the argv the real binary would have received, so the root a flag selects
// is observable without running Terraform.
function invoke(args) {
  return execFileSync('node', [script, ...args], {
    cwd: repository,
    encoding: 'utf8',
    env: { ...process.env, IAC_TOOL: 'echo' }
  }).trim()
}

function rejects(args) {
  try {
    execFileSync('node', [script, ...args], {
      cwd: repository,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, IAC_TOOL: 'echo' }
    })
  } catch (error) {
    return error.stderr
  }
  throw new Error(`expected ${args.join(' ')} to exit non-zero`)
}

test('omitting --root selects the retained Push declarations', { skip: process.platform === 'win32' }, () => {
  for (const environment of ['staging', 'production']) {
    assert.equal(
      invoke(['init', '--env', environment]),
      `-chdir=infra/terraform init -backend-config=backend/${environment}.hcl`
    )
  }
})

test('each root name selects exactly its own directory', { skip: process.platform === 'win32' }, () => {
  const directories = { push: 'infra/terraform' }
  for (const [root, directory] of Object.entries(directories)) {
    for (const environment of ['staging', 'production']) {
      assert.equal(
        invoke(['init', '--env', environment, '--root', root]),
        `-chdir=${directory} init -backend-config=backend/${environment}.hcl`
      )
    }
  }
})

test('an unknown root fails closed rather than falling back to Push', () => {
  const stderr = rejects(['plan', '--env', 'staging', '--root', 'relay'])
  assert.match(stderr, /Unknown --root/)
  assert.doesNotMatch(stderr, /infra\/terraform /)
})

test('a missing environment still fails before any root is resolved', () => {
  assert.match(rejects(['plan']), /Missing --env/)
})

test('plan and apply fail closed while the shared legacy backend may still contain Orca Relay', () => {
  for (const environment of ['staging', 'production']) {
    for (const command of ['plan', 'apply']) {
      const stderr = rejects([command, '--env', environment])
      assert.match(stderr, /disabled until the legacy Orca Relay state is separated or decommissioned/)
    }
  }
})
