export const DAEMON_INIT_TEST_SUPPORT = 'src/main/daemon/daemon-init-dependency-mocks.ts'

const DAEMON_INIT_TEST_SCOPE = new Set([
  DAEMON_INIT_TEST_SUPPORT,
  'src/main/native-chat/agent-session-wire/structured-agent-session-claude-queued-stop.test.ts',
  'config/scripts/process-host-build-dist.test.mjs',
  'src/main/codex/codex-app-server-connection.test.ts'
])

export function isDaemonInitTestSupportChange(files, modifiedOnly = false) {
  return (
    modifiedOnly &&
    files.includes(DAEMON_INIT_TEST_SUPPORT) &&
    new Set(files).size === files.length &&
    files.every((file) => DAEMON_INIT_TEST_SCOPE.has(file))
  )
}

