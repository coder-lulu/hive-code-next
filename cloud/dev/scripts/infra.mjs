import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// The Push declarations retain their historical directory and backend state. The legacy state
// may still contain Orca Relay resources, so this CLI must not apply a Push-only plan to it.
const ROOT_DIRECTORIES = {
  push: join('infra', 'terraform')
}

const command = process.argv[2]
const environment = readEnvironment(process.argv.slice(3))
const root = readRoot(process.argv.slice(3))

if (!command || !['init', 'plan', 'apply'].includes(command)) {
  exitWithUsage()
}

if (!environment) {
  exitWithUsage('Missing --env staging|production')
}

if (!root) {
  exitWithUsage(`Unknown --root; expected one of ${Object.keys(ROOT_DIRECTORIES).join('|')}`)
}

const rootDirectory = ROOT_DIRECTORIES[root]
const terraformDir = join(process.cwd(), rootDirectory)
const backendConfig = join(terraformDir, 'backend', `${environment}.hcl`)
const varFile = join(terraformDir, 'environments', `${environment}.tfvars`)

if (!existsSync(backendConfig)) {
  throw new Error(`Backend config not found: ${backendConfig}`)
}

if (!existsSync(varFile)) {
  throw new Error(`Variable file not found: ${varFile}`)
}

const chdir = `-chdir=${rootDirectory}`

if (command === 'init') {
  run([chdir, 'init', `-backend-config=backend/${environment}.hcl`])
} else {
  throw new Error(
    'Push-only Terraform plan/apply is disabled until the legacy Orca Relay state is separated or decommissioned under a reviewed migration.'
  )
}

function readEnvironment(args) {
  const envIndex = args.indexOf('--env')
  if (envIndex >= 0) {
    return args[envIndex + 1]
  }

  return process.env.ORCA_CLOUD_ENV
}

function readRoot(args) {
  const rootIndex = args.indexOf('--root')
  const requested = rootIndex >= 0 ? args[rootIndex + 1] : 'push'
  return requested in ROOT_DIRECTORIES ? requested : undefined
}

function findTool() {
  for (const candidate of ['tofu', 'terraform']) {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Try the next compatible IaC binary.
    }
  }

  throw new Error('Install Terraform or OpenTofu, or set IAC_TOOL.')
}

function run(args) {
  const tool = process.env.IAC_TOOL || findTool()
  execFileSync(tool, args, { env: terraformEnv(), stdio: 'inherit' })
}

function terraformEnv() {
  if (
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_CREDENTIALS ||
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN
  ) {
    return process.env
  }

  const token = readGcloudAccessToken()
  if (!token) {
    return process.env
  }

  // Local convenience: Terraform uses ADC, while engineers often only have
  // gcloud CLI auth. CI should use Workload Identity instead.
  return { ...process.env, GOOGLE_OAUTH_ACCESS_TOKEN: token }
}

function readGcloudAccessToken() {
  for (const candidate of gcloudCandidates()) {
    try {
      return execFileSync(candidate, ['auth', 'print-access-token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
    } catch {
      // Try the next common gcloud location.
    }
  }

  return null
}

function gcloudCandidates() {
  return [
    process.env.GCLOUD_PATH,
    'gcloud',
    join(homedir(), 'Downloads', 'google-cloud-sdk', 'bin', 'gcloud'),
    join(homedir(), 'google-cloud-sdk', 'bin', 'gcloud')
  ].filter(Boolean)
}

function exitWithUsage(message) {
  if (message) {
    console.error(message)
  }

  console.error(
    'Usage: pnpm infra:<init|plan|apply> --env staging|production [--root push]'
  )
  process.exit(1)
}
