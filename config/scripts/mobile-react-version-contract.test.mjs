import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectDir = fileURLToPath(new URL('../..', import.meta.url))

describe('the mobile React runtime', () => {
  it('pins React to the renderer version instead of allowing a caret upgrade to split them', async () => {
    const manifest = JSON.parse(await readFile(join(projectDir, 'mobile', 'package.json'), 'utf8'))
    const react = manifest.dependencies.react
    const reactTypes = manifest.devDependencies['@types/react']

    expect(react).toMatch(/^\d+\.\d+\.\d+$/)
    const reactTypesVersion = reactTypes.match(/^~?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
    expect(reactTypesVersion).not.toBeNull()
    expect(reactTypesVersion?.slice(1, 3)).toEqual(react.split('.').slice(0, 2))
    expect({
      react,
      reactDom: manifest.dependencies['react-dom'],
      testRenderer: manifest.devDependencies['react-test-renderer']
    }).toEqual({ react, reactDom: react, testRenderer: react })
  })
})
