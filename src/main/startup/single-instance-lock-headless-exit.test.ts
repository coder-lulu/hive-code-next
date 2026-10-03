import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCT_CONFIG } from '../../shared/brand'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from './single-instance-lock'

// Why #11935: a pre-`ready` graceful quit is deferred, so a lock-losing headless `orca serve`
// kept booting into Linux Ozone/X11 init, died with SIGSEGV, and systemd restarted it forever
// until the leaked AppImage FUSE mounts hit the kernel's 1000-mount ceiling.

describe('headless lock-loss exit contract', () => {
  const preflightSource = readFileSync(
    join(process.cwd(), 'src/main/startup/main-process-preflight.ts'),
    'utf8'
  )
  const entrySource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
  const runtimeUnit = readFileSync(
    join(process.cwd(), 'resources/linux/systemd', `${PRODUCT_CONFIG.slug}-runtime.service`),
    'utf8'
  ).replace(/\r\n/g, '\n')

  it('exits the lock-losing launch immediately instead of scheduling a graceful quit', () => {
    const gateStart = preflightSource.indexOf('if (!hasLock) {')
    // Why: bound the anchor — an unresolved indexOf slices to EOF and passes vacuously.
    expect(gateStart).toBeGreaterThanOrEqual(0)
    const gateEnd = preflightSource.indexOf('\n  }', gateStart)
    expect(gateEnd).toBeGreaterThan(gateStart)

    const gate = preflightSource.slice(gateStart, gateEnd)
    expect(gate).toContain('app.exit(SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE)')
    expect(gate).not.toContain('app.quit()')
  })

  it('keeps a duplicate serve launch from promoting the live server to a desktop window', () => {
    const activationStart = entrySource.indexOf('function requestDesktopActivation(')
    expect(activationStart).toBeGreaterThanOrEqual(0)
    const activationEnd = entrySource.indexOf('\n}', activationStart)
    expect(activationEnd).toBeGreaterThan(activationStart)

    expect(entrySource.slice(activationStart, activationEnd)).toContain(
      'shouldActivateDesktopForSecondInstance(argv)'
    )
  })

  it('makes the packaged runtime service treat a duplicate owner as terminal and limit retries', () => {
    expect(runtimeUnit).toMatch(
      new RegExp(`^RestartPreventExitStatus=${SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE}$`, 'm')
    )
    expect(runtimeUnit).toMatch(/^Restart=on-failure$/m)
    expect(runtimeUnit).toMatch(/^StartLimitIntervalSec=[1-9]\d*$/m)
    expect(runtimeUnit).toMatch(/^StartLimitBurst=[1-9]\d*$/m)
  })
})
