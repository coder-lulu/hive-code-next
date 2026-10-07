import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { paperclipCheckoutAliases } from './paperclip-checkout-source.mjs'
import { paperclipExternalExecutionSourceDigest } from './paperclip-source-proof.mjs'

const root = resolve(import.meta.dirname, '../..')
const entry = 'integration/paperclip/core/case-kernel/services/pipeline-case-kernel.ts'
const sourcePinDigest = '6fe5599b66a60c5727938faacc82e8527fdd1794f931206e931edc4832bc27cc'
const pinKeys = [
  'repository',
  'revision',
  'status',
  'sourceEntry',
  'vendoredEntry',
  'license',
  'modules',
  'runtimeExternals',
  'typeOnlyExternals',
  'normalization',
  'typeProject'
]
const moduleKeys = ['module', 'vendoredModule', 'sourceSha256', 'sha256']

export function paperclipCaseKernelAliases(source, projectRoot = root) {
  return {
    ...paperclipCheckoutAliases(source),
    '@hive-paperclip-case-kernel': join(projectRoot, entry)
  }
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

export function verifyPaperclipCaseKernelPin(pin) {
  if (
    !exactKeys(pin, pinKeys) ||
    !Array.isArray(pin.modules) ||
    pin.modules.length !== 17 ||
    pin.modules.some((module) => !exactKeys(module, moduleKeys))
  ) {
    throw new Error('Paperclip Case kernel source proof is required')
  }
  const canonical = Object.fromEntries(pinKeys.map((key) => [key, pin[key]]))
  canonical.modules = pin.modules.map((module) =>
    Object.fromEntries(moduleKeys.map((key) => [key, module[key]]))
  )
  if (createHash('sha256').update(JSON.stringify(canonical)).digest('hex') !== sourcePinDigest) {
    throw new Error('Paperclip Case kernel pin differs from the reviewed source')
  }
}

export async function verifyPaperclipCaseKernelSources(projectRoot, manifest) {
  const pin = manifest.caseTransitionCore
  verifyPaperclipCaseKernelPin(pin)
  if (
    (await paperclipExternalExecutionSourceDigest(projectRoot, pin.typeProject.module)) !==
    pin.typeProject.sha256
  ) {
    throw new Error('Paperclip Case kernel type project differs from the pinned source')
  }
  for (const module of pin.modules) {
    if (
      (await paperclipExternalExecutionSourceDigest(projectRoot, module.vendoredModule)) !==
      module.sha256
    ) {
      throw new Error('Paperclip Case kernel differs from the pinned provider-free source')
    }
  }
  const compiled = await build({
    absWorkingDir: projectRoot,
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
    treeShaking: false,
    external: pin.runtimeExternals,
    logLevel: 'silent'
  })
  const runtimeModules = Object.keys(compiled.metafile.inputs).sort()
  const expected = pin.modules
    .map((module) => module.vendoredModule)
    .filter((module) => !module.endsWith('/pipeline-case-types.ts'))
    .sort()
  const runtimeExternals = [
    ...new Set(
      Object.values(compiled.metafile.inputs).flatMap((module) =>
        module.imports.filter((item) => item.external).map((item) => item.path)
      )
    )
  ].sort()
  if (
    JSON.stringify(runtimeModules) !== JSON.stringify(expected) ||
    JSON.stringify(runtimeExternals) !== JSON.stringify([...pin.runtimeExternals].sort())
  ) {
    throw new Error('Paperclip Case kernel import closure exceeds the reviewed source')
  }
  return {
    repository: pin.repository,
    revision: pin.revision,
    sourcePinDigest,
    normalization: pin.normalization,
    typeProject: pin.typeProject,
    modules: pin.modules,
    runtimeModules,
    runtimeExternals,
    typeOnlyModules: pin.modules
      .map((module) => module.vendoredModule)
      .filter((module) => !runtimeModules.includes(module)),
    typeOnlyExternals: pin.typeOnlyExternals
  }
}
