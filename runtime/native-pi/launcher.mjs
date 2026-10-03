import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { isMainThread } from 'node:worker_threads'
import { hiveModelPreferenceArgs } from './model-preference.mjs'

const cli = fileURLToPath(
  new URL('./node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url)
)
// Node inherits preloads into forks and workers; only configure the Pi entrypoint.
if (isMainThread && process.argv[1] && resolve(process.argv[1]) === cli) {
  // The bundled runtime is versioned and updated with HiveCode.
  process.env.PI_SKIP_VERSION_CHECK = '1'
  process.env.HIVECODE_AI_NATIVE_PID = String(process.pid)
  process.env.PI_TELEMETRY = '0'
  if (process.argv[2] === 'update') {
    console.error('The HiveCode AI runtime is managed by HiveCode. Update HiveCode in Settings.')
    process.exit(1)
  }

  const extension = fileURLToPath(new URL('./hive-provider.mjs', import.meta.url))
  // Preload configuration while the OS retains Pi's recognizable CLI entrypoint.
  process.argv.splice(
    2,
    0,
    '--extension',
    extension,
    '--provider',
    'hivecode',
    ...hiveModelPreferenceArgs(process.argv.slice(2))
  )
}
