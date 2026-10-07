import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { resolveOxcCliInvocation } from './oxc-cli-invocation.mjs'
import { runProcessSync } from './script-child-process.mjs'
import { verifyPaperclipCaseKernelPin } from './paperclip-case-kernel-source.mjs'
import { paperclipExternalExecutionSourceDigest } from './paperclip-source-proof.mjs'
import { normalizePaperclipCaseKernelTypes } from './paperclip-case-kernel-type-normalization.mjs'

export async function normalizePaperclipCaseKernelSources(projectRoot, source, output, pin) {
  verifyPaperclipCaseKernelPin(pin)
  if (!resolve(output).startsWith(`${resolve(projectRoot, 'logs')}${sep}`)) {
    throw new Error('Paperclip Case normalization output must stay under project logs')
  }
  const requireRoot = createRequire(join(projectRoot, 'package.json'))
  for (const stage of pin.normalization) {
    if (stage.tool === 'hive_case_type_normalization') {
      if (
        (await paperclipExternalExecutionSourceDigest(projectRoot, stage.module)) !== stage.sha256
      ) {
        throw new Error('Paperclip Case type normalizer differs from the pin')
      }
      continue
    }
    if (
      requireRoot(`${stage.tool}/package.json`).version !== stage.version ||
      (await paperclipExternalExecutionSourceDigest(projectRoot, stage.config)) !==
        stage.configSha256
    ) {
      throw new Error('Paperclip Case normalization tool or config differs from the pin')
    }
  }
  if (
    (await paperclipExternalExecutionSourceDigest(projectRoot, pin.typeProject.module)) !==
    pin.typeProject.sha256
  ) {
    throw new Error('Paperclip Case normalization type project differs from the pin')
  }
  const contents = []
  for (const module of pin.modules) {
    if (
      (await paperclipExternalExecutionSourceDigest(source, module.module)) !== module.sourceSha256
    ) {
      throw new Error('Paperclip Case normalization input differs from the reviewed raw source')
    }
    contents.push(await readFile(join(source, module.module), 'utf8'))
  }
  const files = pin.modules.map((module) => join(output, module.vendoredModule))
  for (const [index, file] of files.entries()) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, contents[index])
  }
  const commands = []
  for (const stage of pin.normalization) {
    if (stage.tool === 'hive_case_type_normalization') {
      for (const module of pin.modules) {
        const file = join(output, module.vendoredModule)
        const source = await readFile(file, 'utf8')
        await writeFile(file, normalizePaperclipCaseKernelTypes(module.module, source))
      }
      commands.push({ tool: stage.tool, module: stage.module, code: 0 })
      continue
    }
    const invocation = resolveOxcCliInvocation(stage.tool, stage.tool, projectRoot)
    const args = [
      ...invocation.prefixArgs,
      '--config',
      join(projectRoot, stage.config),
      ...stage.arguments,
      ...files
    ]
    const result = runProcessSync({
      program: invocation.command,
      args,
      cwd: projectRoot,
      timeoutMs: 30_000
    })
    commands.push({ tool: stage.tool, args, ...result })
    if (result.code !== 0) {
      throw new Error(`Paperclip Case normalization failed: ${result.stdout}${result.stderr}`)
    }
  }
  const typeProject = join(output, pin.typeProject.module)
  await mkdir(dirname(typeProject), { recursive: true })
  await writeFile(typeProject, await readFile(join(projectRoot, pin.typeProject.module)))
  for (const module of pin.modules) {
    if (
      (await paperclipExternalExecutionSourceDigest(output, module.vendoredModule)) !==
      module.sha256
    ) {
      throw new Error('Paperclip Case normalization does not reproduce the pinned vendor')
    }
  }
  return {
    modules: pin.modules,
    normalization: pin.normalization,
    typeProject: pin.typeProject,
    commands
  }
}
