import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSync } from 'esbuild'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'

const owners = ['shallow-probe', 'shallow-subscription', 'transcript-parent', 'orcad-stop'] as const
const artifactRoot = join(
  process.cwd(),
  'logs',
  'windows-directory-watch-delivery',
  String(process.pid)
)
const bundlePath = join(artifactRoot, 'production-watch.cjs')
const shortPathScript = join(artifactRoot, 'short-path.cmd')
const roots: string[] = []

describe.runIf(process.platform === 'win32')(
  'Windows short directory native watch delivery',
  () => {
    beforeAll(() => {
      mkdirSync(artifactRoot, { recursive: true })
      writeFileSync(shortPathScript, '@echo off\r\n@echo %~s1\r\n')
      buildSync({
        stdin: {
          resolveDir: process.cwd(),
          contents: `
          import { writeFileSync, realpathSync } from 'node:fs';
          import { join } from 'node:path';
          import { measureShallowWatchDelivery } from './src/main/ipc/shallow-watch-delivery-probe';
          import { startShallowWatcher } from './src/main/ipc/parcel-watcher-shallow-subscription';
          import { createTranscriptNativeWatcher } from './src/shared/transcript-native-watcher';
          import { installOrcadStopRequestListeners } from './src/main/orcad/orcad-stop-request-listener';
          const [kind, root] = process.argv.slice(2);
          const canonical = realpathSync.native(root);
          let events = 0;
          let close = () => {};
          const paths = [];
          async function main() {
            if (kind === 'shallow-probe') {
              const delivered = await measureShallowWatchDelivery(500);
              console.log(JSON.stringify({node:process.versions.node, delivered}));
              process.exitCode = delivered ? 0 : 2;
              return;
            }
            if (kind === 'shallow-subscription') {
              const subscription = startShallowWatcher(root, ['owned.txt'],
                next => { events += next.length; paths.push(...next.map(event => event.path)); },
                error => { throw error; });
              close = () => subscription.unsubscribe();
              writeFileSync(join(canonical, 'owned.txt'), 'event');
            }
            if (kind === 'transcript-parent') {
              const filePath = join(root, 'transcript.jsonl');
              writeFileSync(filePath, 'initial');
              const watcher = createTranscriptNativeWatcher(filePath, () => events++,
                () => { throw new Error('native watch failed'); });
              if (!watcher.bind()) throw new Error('native watch did not bind');
              close = () => watcher.dispose();
              writeFileSync(join(canonical, 'transcript.jsonl'), 'event');
            }
            if (kind === 'orcad-stop') {
              const listener = installOrcadStopRequestListeners(() => events++,
                {installRoot: root, pollIntervalMs: 1000});
              close = () => listener.close();
              writeFileSync(join(canonical, '.orcad-stop-request'), '');
            }
            await new Promise(resolve => setTimeout(resolve, 250));
            await close();
            console.log(JSON.stringify({node:process.versions.node, events, paths}));
            process.exitCode = events > 0 ? 0 : 2;
          }
          main().catch(error => { console.error(error); process.exitCode = 1; });
        `
        },
        outfile: bundlePath,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node24',
        logLevel: 'silent'
      })
    })

    afterEach(() => {
      for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it.for(owners)(
      'delivers %s through a real Node child given an 8.3 directory',
      async (owner, context) => {
        const root = mkdtempSync(join(artifactRoot, `${owner}-`))
        roots.push(root)
        const shortName = await runProcess({ program: shortPathScript, args: [root] })
        expect(shortName.code, shortName.stderr).toBe(0)
        const shortRoot = shortName.stdout.trim()
        expect(realpathSync.native(shortRoot)).toBe(realpathSync.native(root))
        if (shortRoot.toLowerCase() === realpathSync.native(root).toLowerCase()) {
          context.skip(
            'This volume has no 8.3 directory alias; native short-path coverage is unavailable'
          )
        }
        const result = await runProcess({
          program: process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath,
          args: [bundlePath, owner, shortRoot],
          env: { ...process.env, TMP: shortRoot, TEMP: shortRoot, ORCA_BACKGROUND_LAUNCH: '1' }
        })
        expect(result.timedOut).toBe(false)
        expect(result.code, result.stderr).toBe(0)
        expect(result.signal).toBeNull()
        expect(result.stderr).toBe('')
        const delivered = JSON.parse(result.stdout)
        expect(delivered.node).toBe(process.env.ORCA_TEST_NODE_VERSION ?? process.versions.node)
        if (owner === 'shallow-probe') {
          expect(delivered.delivered).toBe(true)
        } else {
          expect(delivered.events).toBeGreaterThan(0)
        }
        if (owner === 'orcad-stop') {
          expect(delivered.events).toBe(1)
        }
        if (owner === 'shallow-subscription') {
          expect(delivered.paths).toContain(join(shortRoot, 'owned.txt'))
        }
      }
    )
  }
)
