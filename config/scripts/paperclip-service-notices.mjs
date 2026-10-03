import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export async function paperclipServiceNotices(root, inputs) {
  const packages = new Map()
  for (const input of inputs.filter((file) => file.includes('node_modules/'))) {
    let directory = dirname(resolve(root, input))
    for (let depth = 0; depth < 16; depth += 1) {
      try {
        const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
        if (metadata.name && metadata.version && metadata.license) {
          packages.set(`${metadata.name}@${metadata.version}`, {
            directory,
            license: metadata.license
          })
          break
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error
        }
      }
      const parent = dirname(directory)
      if (parent === directory) {
        break
      }
      directory = parent
    }
  }
  const notices = []
  for (const [name, metadata] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    let license
    for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'UNLICENSE']) {
      try {
        license = await readFile(join(metadata.directory, filename), 'utf8')
        break
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error
        }
      }
    }
    if (!license && name === 'drizzle-orm@0.45.2' && metadata.license === 'Apache-2.0') {
      license = await readFile(
        join(root, 'integration/paperclip/service/licenses/drizzle-orm-0.45.2.txt'),
        'utf8'
      )
    }
    if (!license && name === 'postgres@3.4.9' && metadata.license === 'Unlicense') {
      license = await readFile(
        join(root, 'integration/paperclip/service/licenses/postgres-3.4.9.txt'),
        'utf8'
      )
    }
    if (!license) {
      throw new Error(`License text missing for ${name}`)
    }
    notices.push(`${name}\nDeclared license: ${metadata.license}\n\n${license}`)
  }
  return {
    text: notices.join('\n\n--------------------\n\n'),
    packages: [...packages.keys()].sort()
  }
}
