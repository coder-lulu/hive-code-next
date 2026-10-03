import { createHash } from 'node:crypto'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'
import type { Metafile } from 'esbuild'
import { parse } from 'yaml'

export const packSha256 = (content: Uint8Array | string): string =>
  createHash('sha256').update(content).digest('hex')

const packageSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  license: z.string().min(1)
})
const legalSchema = z.object({
  pi: z.object({
    version: z.string(),
    commit: z.string(),
    url: z.string().url(),
    sha256: z.string()
  }),
  node: z.object({ version: z.string(), url: z.string().url(), sha256: z.string() })
})
const lockSchema = z.object({
  packages: z.record(
    z.string(),
    z.object({ resolution: z.object({ integrity: z.string().min(1) }) })
  )
})
const PI_PACKAGES = new Set([
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-telemetry',
  '@earendil-works/chord'
])

type BundleComponent = {
  type: 'library'
  'bom-ref': string
  name: string
  version: string
  licenses: { license: { id: string } }[]
  properties: { name: string; value: string }[]
}

export async function readPackLegalInputs(
  runtimeRoot: string,
  pins: { node: string; pi: string; commit: string }
) {
  const root = join(runtimeRoot, 'legal')
  const provenance = legalSchema.parse(
    JSON.parse(await readFile(join(root, 'provenance.json'), 'utf8'))
  )
  const pi = await readFile(join(root, 'pi-LICENSE'), 'utf8')
  const node = await readFile(join(root, 'node-LICENSE'), 'utf8')
  if (
    provenance.pi.version !== pins.pi ||
    provenance.pi.commit !== pins.commit ||
    provenance.node.version !== pins.node ||
    packSha256(pi) !== provenance.pi.sha256 ||
    packSha256(node) !== provenance.node.sha256
  ) {
    throw new Error('Managed Pi legal inputs do not match pinned sources')
  }
  return { pi, node, provenance }
}

export async function collectPackBundleNotices(
  runtimeRoot: string,
  metafile: Metafile,
  lockText: string,
  piLicense: string,
  piVersion: string
) {
  const modulesRoot = await realpath(join(runtimeRoot, 'node_modules'))
  const packages = new Map<string, { root: string; data: z.infer<typeof packageSchema> }>()
  const directories = new Map<string, { root: string; data: z.infer<typeof packageSchema> }>()
  for (const input of Object.keys(metafile.inputs)) {
    const inputPath = await realpath(join(runtimeRoot, input))
    const modulePath = relative(modulesRoot, inputPath)
    if (modulePath.startsWith('..') || isAbsolute(modulePath)) {
      if (
        ![
          join(runtimeRoot, 'agent.mjs'),
          join(runtimeRoot, 'text-process.mjs'),
          join(runtimeRoot, '..', '..', 'src', 'shared', 'managed-pi-process-protocol.ts'),
          join(runtimeRoot, '..', '..', 'src', 'shared', 'hive-agent-text-context.ts')
        ].includes(inputPath)
      ) {
        throw new Error('Unexpected runner build input')
      }
      continue
    }
    let current = dirname(inputPath)
    const visited: string[] = []
    let found = directories.get(current)
    while (!found && current !== modulesRoot) {
      visited.push(current)
      try {
        const result = packageSchema.safeParse(
          JSON.parse(await readFile(join(current, 'package.json'), 'utf8'))
        )
        if (result.success) {
          found = { root: current, data: result.data }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
      if (!found) {
        current = dirname(current)
        found = directories.get(current)
      }
    }
    if (!found) {
      throw new Error('Runner dependency has no package identity')
    }
    for (const directory of visited) {
      directories.set(directory, found)
    }
    const key = `${found.data.name}@${found.data.version}`
    const previous = packages.get(key)
    if (previous && previous.root !== found.root) {
      throw new Error('Ambiguous runner dependency identity')
    }
    packages.set(key, found)
  }
  const lock = lockSchema.parse(parse(lockText))
  const components: BundleComponent[] = []
  const notices: string[] = []
  for (const [identity, item] of [...packages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const integrity = lock.packages[identity]?.resolution.integrity
    if (!integrity) {
      throw new Error(`Runner dependency missing from lock: ${identity}`)
    }
    if (
      PI_PACKAGES.has(item.data.name) &&
      (item.data.version !== piVersion || item.data.license !== 'MIT')
    ) {
      throw new Error('Runner Pi dependency differs from pin')
    }
    const licenseFiles = (await readdir(item.root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^licen[cs]e(?:[-.].*)?$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    const texts = await Promise.all(
      licenseFiles.map((entry) => readFile(join(item.root, entry.name), 'utf8'))
    )
    if (texts.length === 0 && PI_PACKAGES.has(item.data.name)) {
      texts.push(piLicense)
    }
    if (texts.length === 0 || texts.some((text) => text.trim().length === 0)) {
      throw new Error(`Missing runner license: ${identity}`)
    }
    const text = texts.join('\n\n')
    notices.push(`${identity} (${item.data.license})\n${text}`)
    components.push({
      type: 'library',
      'bom-ref': identity,
      name: item.data.name,
      version: item.data.version,
      licenses: [{ license: { id: item.data.license } }],
      properties: [
        { name: 'hive:pnpm:integrity', value: integrity },
        { name: 'hive:license:sha256', value: packSha256(text) }
      ]
    })
  }
  for (const name of ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai']) {
    if (!packages.has(`${name}@${piVersion}`)) {
      throw new Error('Runner is missing pinned Pi dependency')
    }
  }
  return { components, notices: notices.join('\n\n----------------------------------------\n\n') }
}
