import { spawnSync } from 'node:child_process'

if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) {
  console.error('HiveCode Runtime .deb must be built on Linux x64 or arm64.')
  process.exit(1)
}

const buildNumber = String(process.env.HIVECODE_BUILD_NUMBER ?? '').trim()
if (!/^[1-9]\d*$/.test(buildNumber) || !Number.isSafeInteger(Number(buildNumber))) {
  throw new Error('HIVECODE_BUILD_NUMBER must be a positive integer for the Runtime deb revision')
}

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'electron-builder',
    '--config',
    'config/electron-builder.config.cjs',
    '--linux',
    'deb',
    `--${process.arch}`,
    '--publish',
    'never',
    ...process.argv.slice(2),
    `--config.buildNumber=${buildNumber}`
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HIVECODE_HEADLESS_RUNTIME_DEB: '1',
      ORCA_LINUX_ARM64_RELEASE: process.arch === 'arm64' ? '1' : '0'
    },
    stdio: 'inherit',
    shell: false
  }
)

if (result.error) {
  throw result.error
}
process.exit(result.status ?? 1)
