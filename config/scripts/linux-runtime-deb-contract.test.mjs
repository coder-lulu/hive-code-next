import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('Linux Runtime deb contract', () => {
  it('packages an x64-only service without enabling it during installation', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'config/linux-runtime-deb-manifest.json'), 'utf8')
    )
    const unit = readFileSync(
      join(root, 'resources/linux/systemd/hivecode-runtime.service'),
      'utf8'
    )
    const afterInstall = readFileSync(
      join(root, 'resources/linux/packaging/after-install.sh'),
      'utf8'
    )
    const builder = readFileSync(join(root, 'config/electron-builder.config.cjs'), 'utf8')
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

    expect(manifest).toMatchObject({
      packageName: 'hivecode-runtime',
      architecture: 'x64',
      packageFormat: 'deb'
    })
    expect(manifest.installBehavior).toEqual({
      enableService: false,
      startService: false,
      preserveStateOnRemove: true
    })
    expect(unit).toContain('User=hivecode-runtime')
    expect(unit).toContain(
      'ExecStart=/usr/bin/hivecode serve --port 6768 --json $HIVECODE_RUNTIME_ARGS'
    )
    expect(unit).toContain('RestartPreventExitStatus=3')
    expect(unit).toContain('KillMode=control-group')
    expect(unit).toContain('NoNewPrivileges=false')
    expect(unit).toContain('PrivateTmp=false')
    expect(unit).toContain('ProtectSystem=full')
    expect(unit).not.toContain('--no-sandbox')
    expect(afterInstall).toContain('hivecode-runtime.service')
    expect(afterInstall).toContain('chmod 4755 "$sandbox"')
    expect(afterInstall).not.toMatch(/systemctl\s+enable/)
    expect(builder).toContain("process.env.HIVECODE_HEADLESS_RUNTIME_DEB === '1'")
    expect(packageJson.scripts['build:linux:runtime-deb']).toContain('build-linux-runtime-deb.mjs')
    expect(packageJson.homepage).toBe('https://github.com/coder-lulu/hive-code-next')
    expect(builder).toContain("'!.pnpm-store{,/**/*}'")
    for (const dependency of [
      'libgtk-3-0',
      'libnspr4',
      'libnss3',
      'libatk-bridge2.0-0',
      'libcups2',
      'libgbm1',
      'libasound2',
      'libxss1'
    ]) {
      expect(builder).toContain(`'${dependency}'`)
    }
    const buildScript = readFileSync(
      join(root, 'config/scripts/build-linux-runtime-deb.mjs'),
      'utf8'
    )
    expect(buildScript).toMatch(/'--publish',\s*'never'/u)
  })

  it('keeps every directly executed Linux package script LF-only', () => {
    for (const relativePath of [
      'resources/linux/bin/hivecode',
      'resources/linux/bin/orca-ide',
      'resources/linux/packaging/after-install.sh',
      'resources/linux/packaging/after-remove.sh'
    ]) {
      const content = readFileSync(join(root, relativePath))
      expect(content.subarray(0, 2).toString('utf8')).toBe('#!')
      expect(content.includes(Buffer.from('\r\n'))).toBe(false)
    }
  })
})
