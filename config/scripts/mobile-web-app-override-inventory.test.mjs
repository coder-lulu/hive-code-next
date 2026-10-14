import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const projectDir = fileURLToPath(new URL('../..', import.meta.url))

it('documents every current web sibling with an existing native counterpart', async () => {
  const mobileDir = join(projectDir, 'mobile')
  const inventory = JSON.parse(await readFile(join(mobileDir, 'web-entry/web-overrides.json'), 'utf8'))
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !['node_modules', 'build', 'dist'].includes(entry.name)) {
        await walk(join(directory, entry.name))
      } else if (entry.isFile() && /\.web\.[tj]sx?$/.test(entry.name) && !entry.name.includes('.test.')) {
        files.push(relative(mobileDir, join(directory, entry.name)).split('\\').join('/'))
      }
    }
  }
  for (const tree of ['app', 'src', 'packages']) {
    await walk(join(mobileDir, tree))
  }
  expect(inventory.overrides.map((entry) => entry.file).sort()).toEqual(files.sort())
  expect(new Set(files).size).toBe(inventory.overrides.length)
  for (const entry of inventory.overrides) {
    expect(entry.reason.trim().length).toBeGreaterThan(0)
    expect((await stat(join(mobileDir, entry.file.replace('.web.', '.')))).isFile()).toBe(true)
  }
})

