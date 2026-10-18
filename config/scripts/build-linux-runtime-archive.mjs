import {
  chmodSync,
  openSync,
  readSync,
  closeSync,
  statSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  NODE_RUNTIME_ASSETS,
  NODE_RUNTIME_PIN,
  nodeRuntimeReleaseUrl
} from '../../src/shared/node-runtime-pin.ts'
import {
  orcadArtifactFilenames,
  orcadNodeRuntimeRelativePath
} from '../../src/shared/orcad-artifacts.ts'
import { fetchPinnedFile, pinnedNodeCacheDir } from './pinned-node-downloads.mjs'
import { extract } from './update-node-runtime-pin.mjs'
import { isDirectInvocation } from './script-entry-detection.mjs'
import floor from './verify-linux-glibc-floor.cjs'
import { hivecodeProductConfig } from '../../src/shared/generated/product-config.ts'

const root = resolve(import.meta.dirname, '../..')

export function runtimeManifest(versionName, buildNumber, architecture) {
  if (!/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(versionName)) {
    throw new Error('Invalid release version')
  }
  if (!/^[1-9]\d*$/.test(String(buildNumber)) || !Number.isSafeInteger(Number(buildNumber))) {
    throw new Error('HIVECODE_BUILD_NUMBER must be a positive safe integer')
  }
  if (!['x64', 'arm64'].includes(architecture)) {
    throw new Error('Unsupported Linux architecture')
  }
  return {
    schemaVersion: 1,
    packageName: 'hivecode-runtime',
    versionName,
    buildNumber: Number(buildNumber),
    architecture,
    glibcMinimum: '2.31',
    nodeVersion: NODE_RUNTIME_PIN.version
  }
}

export function runtimeLauncher(manifest, displayName = hivecodeProductConfig.displayName) {
  const target = `linux-${manifest.architecture}-glibc`
  const sha = NODE_RUNTIME_ASSETS[target].executableSha256
  const quotedName = `'${displayName.replaceAll("'", "'\"'\"'")}'`
  return `#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$(readlink -f -- "$0")")/.." && pwd)
NODE="$ROOT/runtimes/node-${sha}/bin/node"
export ORCA_VERSION='${manifest.versionName}'
APP_NAME=${quotedName}
export ORCA_USER_DATA="\${ORCA_USER_DATA:-\${ORCA_USER_DATA_PATH:-\${XDG_CONFIG_HOME:-$HOME/.config}/$APP_NAME}}"
export ORCA_USER_DATA_PATH="$ORCA_USER_DATA"
unset NODE_OPTIONS NODE_REPL_EXTERNAL_MODULE ELECTRON_RUN_AS_NODE
if [ "\${1:-}" = serve ]; then
  shift
  exec "$NODE" "$ROOT/orcad/orcad-server.js" --bind 0.0.0.0 "$@"
fi
exec "$NODE" "$ROOT/orcad/out/cli/index.js" "$@"
`
}

function regularFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return regularFiles(path)
    }
    if (!entry.isFile() || statSync(path).nlink > 1) {
      throw new Error(`Archive cannot contain links or special files: ${path}`)
    }
    return [path]
  })
}

export function verifyArchivePayload(directory, manifest) {
  const target = `linux-${manifest.architecture}-glibc`
  for (const file of orcadArtifactFilenames(target)) {
    if (!existsSync(join(directory, 'orcad', file))) {
      throw new Error(`Missing Runtime artifact: ${file}`)
    }
  }
  const asset = NODE_RUNTIME_ASSETS[target]
  const node = join(
    directory,
    'orcad',
    ...orcadNodeRuntimeRelativePath(target, asset.executableSha256)
  )
  if (createHash('sha256').update(readFileSync(node)).digest('hex') !== asset.executableSha256) {
    throw new Error('Bundled Node hash does not match pin')
  }
  if (readFileSync(join(directory, 'orcad/.server-target'), 'utf8').trim() !== target) {
    throw new Error('Runtime target mismatch')
  }
  if (
    readFileSync(join(directory, 'orcad/.runtime-node'), 'utf8').trim() !== asset.executableSha256
  ) {
    throw new Error('Runtime Node marker mismatch')
  }
  if (!existsSync(join(directory, 'orcad/out/web/web-index.html'))) {
    throw new Error('Missing bundled Web client')
  }
  const binaries = new Set(floor.collectNativeBinaries(directory))
  for (const file of regularFiles(directory)) {
    const descriptor = openSync(file, 'r')
    const magic = Buffer.alloc(4)
    try {
      readSync(descriptor, magic, 0, 4, 0)
    } finally {
      closeSync(descriptor)
    }
    if (magic.equals(Buffer.from([127, 69, 76, 70])) && !binaries.has(file)) {
      throw new Error(`ELF payload escaped ABI gate: ${file}`)
    }
  }
  floor.verifyLinuxGlibcFloor(directory, { targetArch: manifest.architecture })
}

function run(program, args, env = process.env) {
  const result = spawnSync(program, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${program} failed (${result.status})`)
  }
}

export function packRuntimeArchive(directory, destination) {
  regularFiles(directory)
  mkdirSync(dirname(destination), { recursive: true })
  // Staging contains only independent regular files, so tar cannot emit links.
  run('tar', ['-czf', destination, '-C', dirname(directory), 'hivecode-runtime'])
}

export async function main() {
  if (process.platform !== 'linux') {
    throw new Error('Runtime archives must be built on native Linux runners')
  }
  const versionName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  if (process.env.HIVECODE_VERSION && process.env.HIVECODE_VERSION !== versionName) {
    throw new Error('Release version differs from package.json')
  }
  const manifest = runtimeManifest(versionName, process.env.HIVECODE_BUILD_NUMBER, process.arch)
  const target = `linux-${manifest.architecture}-glibc`
  const stagingParent = join(root, 'out', 'runtime-archive')
  mkdirSync(stagingParent, { recursive: true })
  const staging = mkdtempSync(join(stagingParent, 'stage-'))
  const payload = join(staging, 'hivecode-runtime')
  try {
    run(
      process.execPath,
      [
        join(root, 'config/scripts/build-orcad-node.mjs'),
        '--target',
        target,
        '--out-dir',
        join(payload, 'orcad')
      ],
      { ...process.env, ORCAD_OMIT_AGENT_BROWSER: '1' }
    )
    cpSync(join(root, 'out/web'), join(payload, 'orcad/out/web'), {
      recursive: true,
      dereference: true
    })
    mkdirSync(join(payload, 'licenses'), { recursive: true })
    copyFileSync(join(root, 'LICENSE'), join(payload, 'licenses/HiveCode-LICENSE'))
    const asset = NODE_RUNTIME_ASSETS[target]
    const cacheDir = pinnedNodeCacheDir()
    const archive = await fetchPinnedFile({
      url: nodeRuntimeReleaseUrl(asset.source, asset.archive),
      destination: join(cacheDir, asset.archive),
      sha256: asset.archiveSha256
    })
    const licenseMember = `${asset.archive.replace(/\.tar\.gz$/, '')}/LICENSE`
    extract(archive, staging, licenseMember)
    copyFileSync(join(staging, licenseMember), join(payload, 'licenses/Node-LICENSE'))
    for (const [name, packagePath] of [
      ['node-pty', 'node-pty'],
      ['parcel-watcher', '@parcel/watcher']
    ]) {
      const license = ['LICENSE', 'LICENSE.txt', 'LICENSE.md']
        .map((file) => join(root, 'node_modules', packagePath, file))
        .find(existsSync)
      if (!license) {
        throw new Error(`Missing license: ${name}`)
      }
      copyFileSync(license, join(payload, 'licenses', `${name}-LICENSE`))
    }
    mkdirSync(join(payload, 'bin'), { recursive: true })
    writeFileSync(join(payload, 'bin/hive'), runtimeLauncher(manifest), { mode: 0o755 })
    chmodSync(join(payload, 'bin/hive'), 0o755)
    writeFileSync(join(payload, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    verifyArchivePayload(payload, manifest)
    run(join(payload, 'bin/hive'), ['--version'])
    run(join(payload, 'bin/hive'), ['serve', '--help'])
    packRuntimeArchive(
      payload,
      join(root, 'dist', `hivecode-runtime-${manifest.architecture}.tar.gz`)
    )
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  await main()
}
