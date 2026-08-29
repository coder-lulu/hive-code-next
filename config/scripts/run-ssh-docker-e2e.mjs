import { spawnSync } from 'node:child_process'

const rawExtraArgs = process.argv.slice(2)
const extraArgs = rawExtraArgs[0] === '--' ? rawExtraArgs.slice(1) : rawExtraArgs
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const env = {
  ...process.env,
  ORCA_E2E_SSH_DOCKER: '1',
  ORCA_E2E_WEB_CLIENT: '1'
}

// Why: Node's CVE-2024-27980 hardening rejects .cmd spawns without shell on Windows.
const spawnOptions = {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
}

const runtime = spawnSync(pnpm, ['run', 'ensure:electron-runtime'], spawnOptions)

if (runtime.status !== 0) {
  process.exit(runtime.status ?? 1)
}

// Keep the Docker-gated set explicit: sharded lanes do not set ORCA_E2E_SSH_DOCKER,
// so these specs otherwise self-skip while the lane reports green. The gate contract
// checks that every other Docker-gated spec is named by this runner or a sibling lane.
// The perf/codex/bulk-open repros remain explicit contract exemptions: their wall-clock
// budgets, missing remote binary, and known-rotted helper calls make them unsuitable for
// this correctness lane until their dedicated upstream follow-ups land.
const result = spawnSync(
  pnpm,
  [
    'exec',
    'playwright',
    'test',
    'tests/e2e/pty-input-write-queue-ssh.spec.ts',
    'tests/e2e/ssh-ai-vault-session-history.spec.ts',
    'tests/e2e/ssh-cold-activation-restore.spec.ts',
    'tests/e2e/ssh-cold-hydration-gap-tab-seeding.spec.ts',
    'tests/e2e/ssh-docker-reconnect-pane-restore.spec.ts',
    'tests/e2e/ssh-external-image-preview.spec.ts',
    'tests/e2e/ssh-pi-compatible-agent-title.spec.ts',
    'tests/e2e/ssh-lost-kill-tab-resurrection.spec.ts',
    'tests/e2e/ssh-port-forward-lifecycle.spec.ts',
    'tests/e2e/ssh-reconnect-tab-destruction.spec.ts',
    'tests/e2e/ssh-restart-tab-accumulation.spec.ts',
    'tests/e2e/ssh-skill-installation.spec.ts',
    'tests/e2e/ssh-terminal-window-wake-stale-grid-repro.spec.ts',
    '--config',
    'tests/playwright.config.ts',
    '--project',
    'electron-headless',
    '--project',
    'electron-headful',
    '--workers=1',
    ...extraArgs
  ],
  spawnOptions
)

process.exit(result.status ?? 1)
