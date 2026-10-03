export const LIVE_BACKGROUND_TERMINAL_AGENT_SOURCE = `
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write('Usage: codex [OPTIONS]\\n  --no-daemon  Run without the background daemon\\n')
  process.exit(0)
}
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('codex 0.0.0-e2e\\n')
  process.exit(0)
}
if (args.includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\\n")
  process.exit(2)
}
appendFileSync(process.env.ORCA_E2E_CODEX_SPAWN_LEDGER, JSON.stringify({ args, pid: process.pid }) + '\\n')
process.stdout.write('LIVE_AGENT_READY:' + process.pid + '\\n')
let inputBuffer = ''
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk.toString()
  const lines = inputBuffer.split(/[\\r\\n]+/)
  inputBuffer = lines.pop() || ''
  for (const line of lines) if (line) process.stdout.write('AGENT_INPUT:' + process.pid + ':' + line + '\\n')
})
for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) process.on(signal, () => appendFileSync(process.env.ORCA_E2E_SIGNAL_LEDGER, JSON.stringify({ kind: 'agent', pid: process.pid, signal }) + '\\n'))
process.stdin.resume()
setInterval(() => {}, 60_000)
`
