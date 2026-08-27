import { spawnSync } from 'node:child_process'

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.error('HiveCode Runtime .deb must be built on Linux x64.')
  process.exit(1)
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
    '--x64',
    '--publish',
    'never'
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, HIVECODE_HEADLESS_RUNTIME_DEB: '1' },
    stdio: 'inherit',
    shell: false
  }
)

if (result.error) {
  throw result.error
}
process.exit(result.status ?? 1)
