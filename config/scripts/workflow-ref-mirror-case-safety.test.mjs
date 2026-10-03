import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { runProcessSync } from '../../src/shared/child-process/run-process'

const projectDir = resolve(import.meta.dirname, '../..')

const readWorkflow = (relativePath) => parse(readFileSync(join(projectDir, relativePath), 'utf8'))

describe('product release checkout identities', () => {
  it('retains release-cut history for version reservation and retry ancestry', () => {
    const checkout = readWorkflow('.github/workflows/release-cut.yml').jobs.cut.steps.find(
      (step) => step.uses === 'actions/checkout@v6'
    )
    expect(checkout.with['fetch-depth']).toBe(0)
  })

  it('resolves identical dev identities in full and depth-one checkouts without local tags', () => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-checkout-identity-'))
    const source = join(directory, 'source')
    const shallow = join(directory, 'shallow')
    const run = (program, args, cwd) => {
      const result = runProcessSync({ program, args, cwd })
      expect(result.code, result.stderr).toBe(0)
      return result.stdout.trim()
    }
    const git = (args, cwd = directory) => run('git', args, cwd)
    try {
      git(['init', source])
      git(['config', 'user.name', 'CI test'], source)
      git(['config', 'user.email', 'ci@example.invalid'], source)
      writeFileSync(join(source, 'package.json'), JSON.stringify({ version: '1.4.165-rc.0' }))
      git(['add', 'package.json'], source)
      git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'initial'], source)
      git(['tag', 'v1.4.167'], source)
      git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'head'], source)
      git(['clone', '--depth=1', '--no-tags', pathToFileURL(source).href, shallow])
      expect(git(['rev-list', '--count', 'HEAD'], shallow)).toBe('1')
      expect(git(['tag', '--list'], shallow)).toBe('')
      const script = `
        const result = [];
        for (const [channel, exported] of [['daily', 'Daily'], ['hourly', 'Hourly'], ['adhoc', 'Adhoc']]) {
          const module = await import(${JSON.stringify(pathToFileURL(join(projectDir, 'config/scripts/')).href)} + channel + '-build-version.mjs');
          const date = new Date('2026-09-12T00:00:00Z');
          result.push(channel === 'adhoc'
            ? module.getAdhocBuildIdentity(date, 'branch', ['v1.4.167'])
            : module['get' + exported + 'BuildIdentity'](date, { publishedVersions: ['v1.4.167'], releaseNames: [] }));
        }
        process.stdout.write(JSON.stringify(result));
      `
      const identities = (cwd) => run(process.execPath, ['--input-type=module', '-e', script], cwd)
      expect(identities(shallow)).toBe(identities(source))
      expect(
        JSON.parse(identities(shallow)).every((identity) => identity.version.startsWith('1.4.168-'))
      ).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
