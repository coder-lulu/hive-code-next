import { spawnProcess } from '@orca/process-host'
import { existsSync } from 'node:fs'

const rawExtraArgs = process.argv.slice(2)
const extraArgs = rawExtraArgs[0] === '--' ? rawExtraArgs.slice(1) : rawExtraArgs
const pnpm = 'pnpm'
const env = {
  ...process.env,
  ORCA_E2E_SSH_DOCKER: '1',
  ORCA_E2E_ORCAD_CONVERT_HOST: 'docker'
}

async function runPnpm(args) {
  const child = spawnProcess({ program: pnpm, args, stdio: 'inherit', env })
  return await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

// A missing template otherwise makes every managed-host spec skip and falsely pass.
if (!env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE || !existsSync(env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE)) {
  console.error(
    'Build the managed Orcad template and set ORCA_E2E_ORCAD_CONVERT_TEMPLATE before running Docker SSH E2E.'
  )
  process.exit(1)
}

const runtime = await runPnpm(['run', 'ensure:electron-runtime'])

if (runtime !== 0) {
  process.exit(runtime)
}

// Match the current reusable workflow's managed-host lane. No retired direct-relay runner
// or provider is selected. This command needs Docker plus a built Linux Orcad template;
// a passing routing/unit test is not evidence that these real Docker journeys were run.
// PR E2E remains advisory (verify does not require e2e). Nested-runtime and native macOS
// input-method cases retain their separately documented environment-specific coverage gaps.
const result = await runPnpm([
  'exec',
  'playwright',
  'test',
  'tests/e2e/ssh-orcad-',
  '--config',
  'tests/playwright.config.ts',
  '--project',
  'electron-headless',
  '--workers=1',
  ...extraArgs
])

process.exit(result)
